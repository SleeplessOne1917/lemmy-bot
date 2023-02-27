export const getSecureWebsocketUrl = (instanceDomain: string) =>
  `wss://${instanceDomain}/api/v3/ws`;

export const getInsecureWebsocketUrl = (instanceDomain: string) =>
  `ws://${instanceDomain}/api/v3/ws`;
