export function success(data = null, message = 'Success', statusCode = 200) {
  return {
    success: true,
    message,
    data,
    statusCode,
  };
}

export function error(message = 'Error', statusCode = 500, details = null) {
  return {
    success: false,
    message,
    statusCode,
    details,
  };
}

export function sendSuccess(reply, data = null, message = 'Success', statusCode = 200) {
  return reply.status(statusCode).send(success(data, message, statusCode));
}

export function sendError(reply, message = 'Error', statusCode = 500, details = null) {
  return reply.status(statusCode).send(error(message, statusCode, details));
}
