export const getWebsocketUrl = (instanceDomain: string) =>
  `wss://${instanceDomain}/api/v3/ws`;
