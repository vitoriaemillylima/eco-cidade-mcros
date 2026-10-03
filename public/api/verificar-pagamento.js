const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

module.exports = async (req, res) => {
  const { payment_id } = req.query;
  const mpToken = process.env.MP_ACCESS_TOKEN;

  if (!payment_id) {
    return res.status(400).json({ error: 'payment_id ausente' });
  }

  try {
    // Consulta o pagamento diretamente na API do Mercado Pago
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
      headers: { 'Authorization': `Bearer ${mpToken}` }
    });

    if (!response.ok) {
      return res.status(400).json({ error: 'Erro ao consultar pagamento no Mercado Pago' });
    }

    const paymentData = await response.json();

    if (paymentData.status === 'approved') {
      const emailAluno = paymentData.payer?.email?.toLowerCase();
      const cpfAluno = paymentData.payer?.identification?.number?.replace(/\D/g, '');

      // Atualiza o status no Neon DB para aprovado
      await pool.query(
        `UPDATE alunos 
         SET status_pagamento = 'aprovado' 
         WHERE LOWER(email) = LOWER($1) 
            OR REPLACE(REPLACE(cpf, '.', ''), '-', '') = $2`,
        [emailAluno || '', cpfAluno || '']
      );

      return res.status(200).json({ success: true, status: 'aprovado' });
    }

    return res.status(200).json({ success: true, status: paymentData.status });
  } catch (err) {
    console.error('Erro ao verificar pagamento:', err);
    return res.status(500).json({ error: 'Erro interno ao verificar pagamento' });
  }
};