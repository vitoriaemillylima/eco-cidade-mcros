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
    const body = req.body;
    console.log('[Webhook Recebido]:', JSON.stringify(body));

    const paymentId = body?.data?.id || body?.id;

    if (paymentId && (body.type === 'payment' || body.action?.includes('payment'))) {
      const mpToken = process.env.MP_ACCESS_TOKEN;

      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${mpToken}` }
      });

      if (response.ok) {
        const paymentData = await response.json();
        console.log('[Dados do Pagamento MP]:', paymentData.status, paymentData.payer?.email);

        if (paymentData.status === 'approved') {
          const emailAluno = paymentData.payer?.email?.toLowerCase();
          
          // Tenta pegar o CPF que veio no pagamento (se houver)
          const cpfAluno = paymentData.payer?.identification?.number?.replace(/\D/g, '');

          // Atualiza no Neon DB se o e-mail OU o CPF baterem
          const updateResult = await pool.query(
            `UPDATE alunos 
             SET status_pagamento = 'aprovado' 
             WHERE LOWER(email) = LOWER($1) 
                OR REPLACE(REPLACE(cpf, '.', ''), '-', '') = $2`,
            [emailAluno || '', cpfAluno || '']
          );

          console.log(`[Banco Atualizado] Linhas afetadas: ${updateResult.rowCount}`);
        }
      }
    }
    return res.status(200).send('OK');
  } catch (err) {
    console.error('[Erro no Webhook]:', err.message);
    return res.status(200).send('OK');
  }
};