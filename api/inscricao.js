const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

module.exports = async (req, res) => {
  // Permite apenas requisições POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { nome, email, cpf, endereco, municipio, instituicao, cargo } = req.body;
  const mpToken = process.env.MP_ACCESS_TOKEN;

  if (!mpToken) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado nas variáveis da Vercel' });
  }

  try {
    // A) Salva o aluno no Neon DB como pendente
    const query = `
      INSERT INTO alunos (nome, cpf, endereco, municipio, instituicao, cargo, email, status_pagamento, data_inscricao)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', NOW())
    `;
    const values = [nome, cpf?.replace(/\D/g, ''), endereco, municipio, instituicao, cargo, email?.toLowerCase()];
    await pool.query(query, values);

    // B) Gera a preferência no Mercado Pago
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpToken}`
      },
      body: JSON.stringify({
        items: [{ title: 'Inscrição - Curso MROSC', unit_price: 1.00, quantity: 1, currency_id: 'BRL' }],
        payer: { name: nome, email: email, identification: { type: 'CPF', number: cpf?.replace(/\D/g, '') } },
        back_urls: {
          success: 'https://eco-cidade-mcros.vercel.app/inscricao.html?status=sucesso',
          failure: 'https://eco-cidade-mcros.vercel.app/inscricao.html?status=erro',
          pending: 'https://eco-cidade-mcros.vercel.app/inscricao.html?status=pendente'
        },
        auto_return: 'approved',
        notification_url: 'https://eco-cidade-mcros.vercel.app/api/webhook'
      })
    });

    const mpData = await mpResponse.json();
    if (!mpResponse.ok) {
      throw new Error(mpData.message || 'Erro ao gerar checkout no Mercado Pago');
    }

    return res.status(200).json({ success: true, checkoutUrl: mpData.init_point });
  } catch (err) {
    console.error('Erro na API de Inscrição:', err);
    return res.status(500).json({ error: 'Erro ao gerar pagamento', detalhe: err.message });
  }
};