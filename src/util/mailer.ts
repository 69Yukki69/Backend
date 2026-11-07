// src/lib/mailer.ts
import { Resend } from 'resend';
import { ENV } from '../config/env';

const resend = new Resend(ENV.RESEND_API_KEY);

// ✅ Must be an address on your verified Resend domain
const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || 'Julieta Softdrink <no-reply@julietasoftdrink.site>';

// Optional: where customer replies should go (e.g. your Gmail)
const REPLY_TO = process.env.RESEND_REPLY_TO || undefined;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface OrderItem {
  name:     string;
  quantity: number;
  price:    number;
}

interface SendOrderCompletedEmailParams {
  to:            string;
  orderId:       string;
  items:         OrderItem[];
  total:         number;
  paymentMethod: string;
}

export async function sendOrderCompletedEmail({
  to,
  orderId,
  items,
  total,
  paymentMethod,
}: SendOrderCompletedEmailParams) {
  const itemRows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(i.name)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity} case(s)</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₱${(i.price * i.quantity).toFixed(2)}</td>
      </tr>`
    )
    .join('');

  const { data, error } = await resend.emails.send({
    from:    FROM_EMAIL,
    to,
    ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    subject: `Your order ${orderId} is complete!`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#16a34a">Order Completed ✓</h2>
        <p>Your order <strong>${escapeHtml(orderId)}</strong> has been fulfilled.</p>

        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px;text-align:left">Product</th>
              <th style="padding:8px;text-align:center">Qty</th>
              <th style="padding:8px;text-align:right">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <p><strong>Payment:</strong> ${escapeHtml(paymentMethod)}</p>
        <p style="font-size:18px"><strong>Total: ₱${Number(total).toFixed(2)}</strong></p>
        <p style="color:#6b7280;font-size:12px">Thank you for your purchase!</p>
      </div>
    `,
  });

  // Resend returns { data, error } instead of throwing, so check it explicitly
  if (error) {
    console.error('Resend error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  console.log('Resend sent:', data);
  return data;
}