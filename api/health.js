export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  res.status(200).json({
    success: true,
    message: 'STON.fi API server is running on Vercel - Always fresh price data',
    timestamp: new Date().toISOString(),
    cache: {
      priceDataCached: false, // Always fresh
      assetsMetadataCached: false,
      lastMetadataUpdate: null
    },
    environment: 'vercel'
  });
}