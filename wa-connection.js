export const isAuthResetRequired = (lastDisconnect) => {
  const statusCode = lastDisconnect?.error?.output?.statusCode;
  const errorMessage = lastDisconnect?.error?.output?.payload?.message || "";

  return [401, 440].includes(statusCode) || /conflict|replaced|logged out|not-authorized/i.test(errorMessage);
};

export const getReconnectDelayMs = ({
  shouldResetAuth,
  restartCount = 0,
  defaultDelayMs = 5000,
  resetDelayMs = 15000,
  maxDelayMs = 15000,
}) => {
  if (shouldResetAuth) {
    return resetDelayMs;
  }

  return Math.min(defaultDelayMs * (restartCount + 1), maxDelayMs);
};
