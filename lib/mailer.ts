type InviteMail = {
  to: string;
  url: string;
  workspaceName: string;
  roleLabel: string;
};

/**
 * Sends an invitation through SMTP when configured. Dev environments without
 * SMTP still get a copyable invitation URL from the admin UI.
 */
export async function sendInvitationEmail(mail: InviteMail): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const host = process.env.SMTP_HOST;
  if (!host) return { sent: false, reason: "SMTP_HOST is not configured" };
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user || "no-reply@atlas.local";
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "1" || port === 465,
      auth: user ? { user, pass } : undefined,
    });
    await transporter.sendMail({
      from,
      to: mail.to,
      subject: `${mail.workspaceName} への招待`,
      text: [
        `${mail.workspaceName} への招待が届きました。`,
        `権限: ${mail.roleLabel}`,
        "",
        "以下のリンクから名前とパスワードを設定してください。",
        mail.url,
        "",
        "このリンクは7日間有効です。",
      ].join("\n"),
      html: `<p>${mail.workspaceName} への招待が届きました。</p>
<p>権限: <strong>${mail.roleLabel}</strong></p>
<p><a href="${mail.url}">招待を承認してアカウントを作成</a></p>
<p>このリンクは7日間有効です。</p>`,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
