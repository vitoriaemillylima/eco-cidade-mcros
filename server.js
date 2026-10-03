const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Servir arquivos estáticos da pasta 'public' (HTMLs, CSS, imagens)
app.use(express.static(path.join(__dirname, 'public')));

// Configuração de conexão com o Neon DB (SSL obrigatório para Vercel Serverless)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- ROTAS DA APLICAÇÃO ---

// Rota principal (Landing Page)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. Rota de Inscrição (Cria o participante com status 'pendente')
app.post('/api/inscrever', async (req, res) => {
  const { nome, cpf, endereco, municipio, instituicao, cargo, email } = req.body;

  if (!nome || !cpf || !email) {
    return res.status(400).json({ error: 'Campos obrigatórios: nome, cpf e email.' });
  }

  try {
    const query = `
      INSERT INTO alunos (nome, cpf, endereco, municipio, instituicao, cargo, email, status_pagamento, data_inscricao)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendente', NOW())
      RETURNING *;
    `;
    const values = [
      nome.trim(),
      cpf.replace(/\D/g, ''), // Limpa formatação do CPF
      endereco || '',
      municipio || '',
      instituicao || '',
      cargo || '',
      email.trim().toLowerCase()
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, aluno: result.rows[0] });

  } catch (err) {
    console.error('Erro ao cadastrar aluno no Neon DB:', err);
    res.status(500).json({ error: 'Erro interno ao registrar inscrição' });
  }
});

// 2. Rota para o Painel Admin (Tabela de Inscritos)
app.get('/api/alunos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM alunos ORDER BY id DESC');
    
    // Garante que a resposta não fique em cache pelo navegador/Vercel Edge
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erro ao consultar a lista de alunos:', err);
    res.status(500).json({ error: 'Erro na conexão com o banco de dados' });
  }
});

// 3. Webhook do Mercado Pago (Confirmação de Pagamento)
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data, action } = req.body;

    // Identifica chamadas de evento de pagamento
    const paymentId = data?.id || req.body?.data?.id;

    if (paymentId && (type === 'payment' || action?.includes('payment'))) {
      const mpToken = process.env.MP_ACCESS_TOKEN;

      if (!mpToken) {
        console.error('ERRO: MP_ACCESS_TOKEN não está definido nas variáveis da Vercel');
        return res.status(500).send('Configuração ausente no servidor');
      }

      // Validação direta com os servidores do Mercado Pago
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${mpToken}`
        }
      });

      if (response.ok) {
        const paymentData = await response.json();
        const status = paymentData.status; // Ex: 'approved', 'pending'
        const emailAluno = paymentData.payer?.email?.toLowerCase();
        const cpfAluno = paymentData.payer?.identification?.number?.replace(/\D/g, '');

        console.log(`[Webhook] ID: ${paymentId} | Status: ${status} | Email: ${emailAluno}`);

        if (status === 'approved') {
          // Atualiza status no Neon DB buscando por email ou CPF do pagador
          const updateQuery = `
            UPDATE alunos 
            SET status_pagamento = 'aprovado' 
            WHERE LOWER(email) = LOWER($1) 
               OR REPLACE(REPLACE(cpf, '.', ''), '-', '') = $2
          `;
          const updateResult = await pool.query(updateQuery, [emailAluno, cpfAluno]);

          console.log(`[Webhook] Linhas afetadas no banco: ${updateResult.rowCount}`);
        }
      }
    }

    // Retorna sempre 200 OK para o Mercado Pago não tentar reenviar repetidamente
    res.status(200).send('OK');

  } catch (err) {
    console.error('Erro no processamento do Webhook:', err);
    res.status(200).send('OK');
  }
});

// Rota Fallback para servir arquivos estáticos e rotas diretas (.html)
app.get('*', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });
});

module.exports = app;

// Execução em ambiente de desenvolvimento local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor rodando localmente na porta ${PORT}`);
  });
}