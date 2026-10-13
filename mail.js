import nodemailer from 'nodemailer';

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export async function sendVerificationEmail(to, link) {
  // Sem SMTP configurado (desenvolvimento), o link aparece no terminal.
  if (!transport) {
    console.log(`\n[DEV] Link de verificação para ${to}:\n${link}\n`);
    return;
  }
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Confirma o teu email · ULO Vida',
    text: `Olá!\n\nClica neste link para confirmares o teu email e criares a tua conta (válido 1 hora):\n${link}\n\nSe não foste tu, ignora este email.`,
    html: `<p>Olá!</p><p>Clica no botão para confirmares o teu email e criares a tua conta (válido 1 hora):</p>
           <p><a href="${link}" style="background:#7a1f2b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Confirmar email</a></p>
           <p style="color:#666">Se não foste tu, ignora este email.</p>`,
  });
}
