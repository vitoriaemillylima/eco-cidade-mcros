const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Conexão com o Neon DB (suporta DATABASE_URL ou POSTGRES_URL da integração Vercel)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false // Obrigatório para o Neon DB na Vercel
  }
});

// 1. Rota de cadastro de aluno
app.post('/api/inscrever', async (req, res) => {
  const { nome, cpf, endereco, municipio, instituicao, cargo, email } = req.body;

  try {
    const query = `
      INSERT INTO alunos (nome, cpf, endereco, municipio, instituicao, cargo, email, status_pagamento, data_inscricao)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', NOW())
      RETURNING *;
    `;
    const values = [nome, cpf, endereco, municipio, instituicao, cargo, email];
    const result = await pool.query(query, values);

    res.status(201).json({ success: true, aluno: result.rows[0] });
  } catch (err) {
    console.error('Erro ao cadastrar aluno:', err);
    res.status(500).json({ error: 'Erro ao registrar inscrição no banco' });
  }
});

// 2. Rota para buscar inscritos (usada pelo admin.html)
app.get('/api/alunos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM alunos ORDER BY id DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar alunos no Neon DB:', err);
    res.status(500).json({ error: 'Erro no banco de dados' });
  }
});

// 3. Webhook do Mercado Pago (atualiza status de pagamento)
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;

      // Consulta status do pagamento na API do Mercado Pago
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      });

      if (response.ok) {
        const paymentData = await response.json();
        const status = paymentData.status; // 'approved', 'pending', etc.
        const emailAluno = paymentData.payer?.email;

        if (status === 'approved' && emailAluno) {
          await pool.query(
            "UPDATE alunos SET status_pagamento = 'aprovado' WHERE email = $1",
            [emailAluno]
          );
        }
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.status(500).send('Erro interno no webhook');
  }
});

// Exporta para o Serverless da Vercel
module.exports = app;

// Inicia o servidor se rodar localmente
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor rodando localmente na porta ${PORT}`);
  });
}