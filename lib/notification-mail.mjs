/** @param {Record<string,string|undefined>} [env] */
export function notificationMailConfig(env = process.env) {
  let appUrl = null;
  try {
    const url = new URL(env.APP_URL || env.APP_ORIGIN || "");
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) appUrl = url.origin;
  } catch { /* A request Host header is never a fallback. */ }
  const port = Number(env.SMTP_PORT || 587);
  const reason = !env.SMTP_HOST ? "smtp_unconfigured" : !appUrl ? "app_url_unconfigured"
    : !Number.isInteger(port) || port < 1 || port > 65535 ? "smtp_invalid_port" : null;
  return { configured: reason === null, reason, appUrl,
    smtp: { host: env.SMTP_HOST || "", port, secure: env.SMTP_SECURE === "1" || port === 465,
      user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM || env.SMTP_USER || "no-reply@atlas.local" } };
}

export function notificationMessageId(sourceId, userId) {
  return `<atlas-notification-${sourceId}-${userId}@atlas.local>`;
}

export async function sendNotificationMail(config, mail) {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    connectionTimeout: 3000, greetingTimeout: 3000, socketTimeout: 5000,
  });
  try { return await transporter.sendMail({ from: config.smtp.from, ...mail }); }
  finally { transporter.close(); }
}
