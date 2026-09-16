import QRCode from 'qrcode';

export default async function handler(req, res) {
  const text = typeof req.query?.text === 'string' ? req.query.text : '';
  if (!text) return res.status(400).send('Missing');
  try {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(await QRCode.toString(text, {
      type: 'svg',
      width: 520,
      margin: 1,
      color: { dark: '#123858', light: '#ffffff' }
    }));
  } catch (error) {
    console.error(error);
    res.status(500).send('QR failed');
  }
}
