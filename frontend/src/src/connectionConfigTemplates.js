const CONNECTION_CONFIG_TEMPLATES = {
  postgres: `{
  "host": "localhost",
  "port": "5432",
  "user": "postgres",
  "dbname": "my_database",
  "secret": {
    "password": "your_password"
  }
}`,

  clickhouse: `{
  "host": "localhost",
  "port": "8123",
  "user": "default",
  "dbname": "my_database",
  "secret": {
    "password": "your_password"
  }
}`,

  python: `{}`
};

export const getConnectionConfigTemplate = (type) => {
  return CONNECTION_CONFIG_TEMPLATES[type] || '';
};