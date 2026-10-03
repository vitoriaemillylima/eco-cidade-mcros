const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  try {
    const { type, data, action } = req.body;
    const paymentId = data?.id || req.body?.data?.id;

    if (paymentId && (type === 'payment' || action?.includes('payment'))) {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}` }
      });

      if (response.ok) {
        const paymentData = await response.json();
        if (paymentData.status === 'approved') {
          const emailAluno = paymentData.payer?.email?.toLowerCase();
          await pool.query(
            `UPDATE alunos SET status_pagamento = 'aprovado' WHERE LOWER(email) = $1`,
            [emailAluno]
          );
        }
      }
    }
    return res.status(200).send('OK');
  } catch (err) {
    return res.status(200).send('OK');
  }
};