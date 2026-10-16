import axios from 'axios';
import { sha256 as sha256Hash } from 'js-sha256';

const REFRESH_TOKEN_KEY = 'belt_oidc_refresh_token';

let accessToken = null;
let accessTokenExpiresAt = 0;
let authConfig = null;
let refreshPromise = null;
let redirectInProgress = false;
let rawFetch = window.fetch.bind(window);

const baseApiUrl = ["3000", "5173"].includes(window.location.port)
  ? `http://${window.location.hostname}:8000`
  : "/api";

const parseJwtPayload = (token) => {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=')));
  } catch {
    return {};
  }
};

const getCurrentUserDisplayName = (token = accessToken) => {
  if (!token) return '';

  const payload = parseJwtPayload(token);
  const fullName = [payload.given_name, payload.family_name].filter(Boolean).join(' ').trim();

  return payload.name || fullName || payload.preferred_username || payload.email || '';
};

const getCurrentUserEmail = (token = accessToken) => {
  if (!token) return '';

  const payload = parseJwtPayload(token);
  return payload.email || '';
};

const hasDeployPermission = (token = accessToken) => {
  if (!token) return true;

  const payload = parseJwtPayload(token);
  const clientId = process.env.REACT_APP_OIDC_CLIENT_ID || '';
  const roles = payload.resource_access?.[clientId]?.roles || [];

  return roles.includes('deploy');
};

const randomBytes = (size) => {
  const bytes = new Uint8Array(size);
  window.crypto.getRandomValues(bytes);
  return bytes;
};

const base64UrlEncode = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const sha256 = async (value) => sha256Hash.arrayBuffer(value);

const discover = async (issuer) => {
  const response = await rawFetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error(`OIDC discovery failed: HTTP ${response.status}`);
  return response.json();
};

const setAccessToken = (token) => {
  accessToken = token || null;
  const payload = parseJwtPayload(accessToken || '');
  accessTokenExpiresAt = Number(payload.exp || 0) * 1000;
};

const clearTokens = () => {
  setAccessToken(null);
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
};

const logout = () => {
  clearTokens();

  if (!authConfig) {
    window.location.assign(window.location.origin);
    return;
  }

  const logoutEndpoint = authConfig.endSessionEndpoint
    || `${authConfig.issuer}/protocol/openid-connect/logout`;
  const params = new URLSearchParams({
    client_id: authConfig.clientId,
    post_logout_redirect_uri: window.location.origin
  });

  window.location.assign(`${logoutEndpoint}?${params}`);
};

const redirectToLogin = () => {
  if (redirectInProgress) return;
  redirectInProgress = true;

  const state = base64UrlEncode(randomBytes(32));
  const verifier = base64UrlEncode(randomBytes(32));
  window.sessionStorage.setItem('belt_oidc_state', state);
  window.sessionStorage.setItem('belt_oidc_verifier', verifier);

  sha256(verifier).then((digest) => {
    const params = new URLSearchParams({
      client_id: authConfig.clientId,
      redirect_uri: authConfig.redirectUri,
      response_type: 'code',
      scope: authConfig.scope,
      state,
      code_challenge: base64UrlEncode(new Uint8Array(digest)),
      code_challenge_method: 'S256'
    });
    window.location.assign(`${authConfig.authorizationEndpoint}?${params}`);
  });
};

const tokenRequest = async (body) => {
  const response = await rawFetch(authConfig.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body)
  });

  if (!response.ok) throw new Error(`OIDC token request failed: HTTP ${response.status}`);
  return response.json();
};

const exchangeCode = async (code) => {
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: authConfig.clientId,
    code,
    redirect_uri: authConfig.redirectUri,
    code_verifier: window.sessionStorage.getItem('belt_oidc_verifier') || ''
  });
  window.sessionStorage.removeItem('belt_oidc_state');
  window.sessionStorage.removeItem('belt_oidc_verifier');
  window.sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token || '');
  setAccessToken(tokens.access_token);
};

const refreshAccessToken = async () => {
  if (refreshPromise) return refreshPromise;

  const refreshToken = window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;

  refreshPromise = tokenRequest({
    grant_type: 'refresh_token',
    client_id: authConfig.clientId,
    refresh_token: refreshToken
  }).then((tokens) => {
    if (tokens.refresh_token) {
      window.sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
    }
    setAccessToken(tokens.access_token);
    return true;
  }).catch(() => {
    clearTokens();
    return false;
  }).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
};

const getValidAccessToken = async () => {
  if (accessToken && accessTokenExpiresAt > Date.now() + 30000) return accessToken;
  if (await refreshAccessToken()) return accessToken;
  return null;
};

const initializeAuth = async () => {
  const issuer = (process.env.REACT_APP_OIDC_ISSUER_URL || '').replace(/\/$/, '');
  const clientId = process.env.REACT_APP_OIDC_CLIENT_ID || '';
  const required = process.env.REACT_APP_OIDC_REQUIRED === 'true';

  if (!issuer || !clientId) {
    if (required) throw new Error('OIDC is required but frontend configuration is incomplete');
    return { required: false, authenticated: false };
  }

  const discovery = await discover(issuer);
  authConfig = {
    issuer,
    clientId,
    scope: process.env.REACT_APP_OIDC_SCOPE || 'openid profile email',
    redirectUri: process.env.REACT_APP_OIDC_REDIRECT_URI || window.location.origin,
    authorizationEndpoint: discovery.authorization_endpoint,
    tokenEndpoint: discovery.token_endpoint,
    endSessionEndpoint: discovery.end_session_endpoint
  };

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (code) {
    if (params.get('state') !== window.sessionStorage.getItem('belt_oidc_state')) {
      throw new Error('OIDC state validation failed');
    }
    await exchangeCode(code);
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (!await getValidAccessToken() && required) {
    redirectToLogin();
    return { required: true, authenticated: false };
  }

  window.setInterval(() => {
    if (accessTokenExpiresAt && accessTokenExpiresAt <= Date.now() + 60000) refreshAccessToken();
  }, 30000);

  return { required, authenticated: Boolean(accessToken) };
};

const installAuthInterceptors = () => {
  axios.interceptors.request.use(async (config) => {
    const token = await getValidAccessToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  axios.interceptors.response.use(
    (response) => response,
    async (error) => {
      const request = error.config;
      if (error.response?.status !== 401 || !authConfig) {
        return Promise.reject(error);
      }

      if (request?._beltAuthRetry) {
        clearTokens();
        redirectToLogin();
        return Promise.reject(error);
      }

      request._beltAuthRetry = true;
      if (!await refreshAccessToken()) {
        clearTokens();
        redirectToLogin();
        return Promise.reject(error);
      }

      request.headers = request.headers || {};
      request.headers.Authorization = `Bearer ${accessToken}`;
      return axios(request);
    }
  );

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const isTokenRequest = authConfig && url.startsWith(authConfig.issuer);
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
    const token = !isTokenRequest ? await getValidAccessToken() : null;
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await rawFetch(input, { ...init, headers });
    if (response.status !== 401 || isTokenRequest || !authConfig) return response;

    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      clearTokens();
      redirectToLogin();
      return response;
    }

    const retryHeaders = new Headers(headers);
    retryHeaders.set('Authorization', `Bearer ${accessToken}`);
    const retryResponse = await rawFetch(input, { ...init, headers: retryHeaders });
    if (retryResponse.status === 401) {
      clearTokens();
      redirectToLogin();
    }
    return retryResponse;
  };
};

export {
  initializeAuth,
  installAuthInterceptors,
  baseApiUrl,
  getValidAccessToken,
  getCurrentUserDisplayName,
  getCurrentUserEmail,
  hasDeployPermission,
  logout
};
