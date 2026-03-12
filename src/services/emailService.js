const crypto = require("crypto");
const nodemailer = require("nodemailer");

function createEmailService({ appBaseUrl, mailFrom, smtpHost, smtpPort, smtpUser, smtpPass }) {
  let mailTransporter = null;

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function buildTokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  function getMailTransporter() {
    if (mailTransporter !== null) {
      return mailTransporter;
    }

    const portValue = Number(smtpPort || 587);
    if (!smtpHost || !smtpUser || !smtpPass || Number.isNaN(portValue)) {
      mailTransporter = undefined;
      return mailTransporter;
    }

    mailTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: portValue,
      secure: portValue === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    return mailTransporter;
  }

  async function sendVerificationEmail(email, token) {
    const transporter = getMailTransporter();
    if (!transporter) {
      return false;
    }

    const verifyUrl = `${appBaseUrl}/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    await transporter.sendMail({
      from: mailFrom,
      to: email,
      subject: "Confirm your MTG Tournament account",
      text: `Welcome! Please confirm your email using this link: ${verifyUrl}`,
      html: `<p>Welcome! Please confirm your email using this link:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });

    return true;
  }

  return {
    isValidEmail,
    buildTokenHash,
    sendVerificationEmail,
  };
}

module.exports = {
  createEmailService,
};
