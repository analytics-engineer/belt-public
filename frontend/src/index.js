import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './themes.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { initializeAuth, installAuthInterceptors } from './auth';

const root = ReactDOM.createRoot(document.getElementById('root'));

function renderApp() {
  root.render(<App />);
}

initializeAuth()
  .then(() => {
    installAuthInterceptors();
    renderApp();
  })
  .catch((error) => {
    root.render(<div style={{ padding: '24px', color: '#b00020' }}>{error.message}</div>);
  });

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();

