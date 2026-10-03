const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do Pool do Neon DB com fallback seguro
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let pool;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('Erro no pool do Postgres:', err);
  });
}

// 1. Rota Principal - Garante que a Landing Page SEMPRE abra
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Rota de Cadastro de Alunos
app.post('/api/inscrever', async (req, res) => {
  const { nome, cpf, endereco, municipio, instituicao, cargo, email } = req.body;

  if (!pool) {
    return res.status(500).json({ error: 'DATABASE_URL não configurada no servidor' });
  }

  try {
    const query = `
      INSERT INTO alunos (nome, cpf, endereco, municipio, instituicao, cargo, email, status_pagamento, data_inscricao)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', NOW())
      RETURNING *;
    `;
    const values = [
      nome?.trim(),
      cpf?.replace(/\D/g, ''),
      endereco || '',
      municipio || '',
      instituicao || '',
      cargo || '',
      email?.trim().toLowerCase()
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, aluno: result.rows[0] });
  } catch (err) {
    console.error('Erro ao cadastrar aluno:', err);
    res.status(500).json({ error: 'Erro ao registrar no banco', details: err.message });
  }
});

// 3. Rota de Consulta para o Painel Admin
app.get('/api/alunos', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'DATABASE_URL não configurada no servidor' });
  }

  try {
    const result = await pool.query('SELECT * FROM alunos ORDER BY id DESC');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar alunos:', err);
    res.status(500).json({ error: 'Erro de conexão com o banco de dados', details: err.message });
  }
});

// 4. Webhook do Mercado Pago
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data, action } = req.body;
    const paymentId = data?.id || req.body?.data?.id;

    if (paymentId && (type === 'payment' || action?.includes('payment'))) {
      const mpToken = process.env.MP_ACCESS_TOKEN;
      if (mpToken && pool) {
        const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${mpToken}` }
        });

        if (response.ok) {
          const paymentData = await response.json();
          if (paymentData.status === 'approved') {
            const emailAluno = paymentData.payer?.email?.toLowerCase();
            const cpfAluno = paymentData.payer?.identification?.number?.replace(/\D/g, '');

            await pool.query(
              `UPDATE alunos 
               SET status_pagamento = 'aprovado' 
               WHERE LOWER(email) = LOWER($1) 
                  OR REPLACE(REPLACE(cpf, '.', ''), '-', '') = $2`,
              [emailAluno, cpfAluno]
            );
          }
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no Webhook:', err);
    res.status(200).send('OK');
  }
});

// Fallback universal para páginas estáticas
app.use((req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
}