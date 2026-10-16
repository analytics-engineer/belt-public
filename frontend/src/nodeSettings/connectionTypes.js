export const normalizeConnectionType = (type) =>
  String(type || '').trim().toLowerCase();

export const getSelectedConnection = (connections, connectionId) =>
  connections.find((c) => String(c.id) === String(connectionId));

export const isConnectionType = (connection, type) =>
  normalizeConnectionType(connection?.connection_type) === type;