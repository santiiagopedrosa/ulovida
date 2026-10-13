import nodemailer from 'nodemailer';

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

export async function sendVerificationCode(to, code) {
  // Sem SMTP configurado (desenvolvimento), o código aparece no terminal.
  if (!transport) {
    console.log(`\n[DEV] Código de verificação para ${to}: ${code}\n`);
    return;
  }
  // Sem links nem botões: é o que os filtros do Outlook tratam como menos suspeito.
  const info = await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `${code} é o teu código ULO Vida`,
    text: `Olá!\n\nO teu código para criares conta no ULO Vida é:\n\n${code}\n\nÉ válido durante 15 minutos. Se não foste tu, ignora este email.`,
    html: `<div style="font-family:system-ui,sans-serif;color:#22161a">
             <p>Olá!</p>
             <p>O teu código para criares conta no ULO Vida é:</p>
             <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
             <p style="color:#74656a">É válido durante 15 minutos. Se não foste tu, ignora este email.</p>
           </div>`,
  });
  // Fica nos logs (Vercel) para se poder confirmar que o Gmail aceitou o email.
  console.log(`Código de verificação enviado para ${to}: ${info.response}`);
}
