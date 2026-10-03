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

// Inicialização segura do Pool do Neon DB
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
    console.error('[Postgres Pool Error]', err.message);
  });
}

// 1. Rota Principal
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
      nome ? nome.trim() : '',
      cpf ? cpf.replace(/\D/g, '') : '',
      endereco || '',
      municipio || '',
      instituicao || '',
      cargo || '',
      email ? email.trim().toLowerCase() : ''
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, aluno: result.rows[0] });
  } catch (err) {
    console.error('Erro ao cadastrar aluno:', err.message);
    res.status(500).json({ error: 'Erro ao registrar no banco de dados' });
  }
});

// 3. Rota de Criar Pagamento no Mercado Pago (Pix / Checkout)
app.post('/api/criar-pagamento', async (req, res) => {
  const mpToken = process.env.MP_ACCESS_TOKEN;

  if (!mpToken) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado nas variáveis de ambiente' });
  }

  const { email, nome, valor, descricao, cpf } = req.body;

  try {
    // Chamada oficial para a API do Mercado Pago (Criação de Preferência / Pagamento)
    const preferenceData = {
      items: [
        {
          title: descricao || 'Inscrição Evento Eco Cidade',
          unit_price: Number(valor) || 50.00,
          quantity: 1,
          currency_id: 'BRL'
        }
      ],
      payer: {
        name: nome,
        email: email,
        identification: cpf ? { type: 'CPF', number: cpf.replace(/\D/g, '') } : undefined
      },
      back_urls: {
        success: 'https://eco-cidade-mcros.vercel.app/sucesso.html',
        failure: 'https://eco-cidade-mcros.vercel.app/erro.html',
        pending: 'https://eco-cidade-mcros.vercel.app/pendente.html'
      },
      auto_return: 'approved',
      notification_url: 'https://eco-cidade-mcros.vercel.app/api/webhook'
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpToken}`
      },
      body: JSON.stringify(preferenceData)
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Erro Mercado Pago API:', data);
      return res.status(500).json({ error: 'Falha ao gerar pagamento no Mercado Pago', details: data });
    }

    // Retorna o link para abrir a tela de pagamento
    res.status(200).json({
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
      id: data.id
    });

  } catch (err) {
    console.error('Erro ao criar pagamento:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar pagamento' });
  }
});

// 4. Rota do Painel Admin
app.get('/api/alunos', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'DATABASE_URL não configurada' });
  }

  try {
    const result = await pool.query('SELECT * FROM alunos ORDER BY id DESC');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar alunos:', err.message);
    res.status(500).json({ error: 'Erro de conexão com o banco de dados', details: err.message });
  }
});

// 5. Webhook do Mercado Pago (Notificação automática de pagamento aprovado)
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data, action } = req.body;
    const paymentId = data?.id || req.body?.data?.id;

    if (paymentId && (type === 'payment' || (action && action.includes('payment')))) {
      const mpToken = process.env.MP_ACCESS_TOKEN;

      if (mpToken && pool) {
        const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${mpToken}`
          }
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
            console.log(`[Webhook] Pagamento ${paymentId} aprovado com sucesso!`);
          }
        }
      }
    }
    res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no Webhook:', err.message);
    res.status(200).send('OK');
  }
});

// Fallback universal para arquivos da pasta 'public'
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