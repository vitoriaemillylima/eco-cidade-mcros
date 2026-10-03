const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

// 1. Rota Única: Salva aluno e gera o link do Mercado Pago
app.post('/api/inscricao', async (req, res) => {
  const { nome, email, cpf, endereco, municipio, instituicao, cargo } = req.body;
  const mpToken = process.env.MP_ACCESS_TOKEN;

  try {
    // Salva no banco como pendente
    const query = `
      INSERT INTO alunos (nome, cpf, endereco, municipio, instituicao, cargo, email, status_pagamento, data_inscricao)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', NOW())
    `;
    const values = [nome, cpf?.replace(/\D/g, ''), endereco, municipio, instituicao, cargo, email?.toLowerCase()];
    await pool.query(query, values);

    // Gera o checkout no Mercado Pago (Pix/Cartão)
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
    if (!mpResponse.ok) throw new Error(mpData.message);

    res.status(200).json({ success: true, checkoutUrl: mpData.init_point });
  } catch (err) {
    console.error('Erro:', err);
    res.status(500).json({ error: 'Erro ao gerar pagamento' });
  }
});

// 2. Webhook: Muda o status para pago automaticamente
app.post('/api/webhook', async (req, res) => {
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
          
          // Atualiza no Neon DB
          await pool.query(
            `UPDATE alunos SET status_pagamento = 'aprovado' WHERE LOWER(email) = $1`,
            [emailAluno]
          );
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    res.status(200).send('OK');
  }
});

// Entrega as páginas do site
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

module.exports = app;