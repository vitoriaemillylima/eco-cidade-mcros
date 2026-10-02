require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

// Serve arquivos da pasta public e da raiz
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname)));

app.get('/inscricao.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'inscricao.js'));
});

// Banco Neon
const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Mercado Pago Produção
const client = new MercadoPagoConfig({ 
    accessToken: (process.env.MP_ACCESS_TOKEN || '').trim() 
});
const preference = new Preference(client);

// -------------------------------------------------------------------
// ROTA DE INSCRIÇÃO (PRODUÇÃO)
// -------------------------------------------------------------------
app.post('/api/inscricao', async (req, res) => {
    const { nome, email, cpf, endereco, municipio, instituicao, cargo } = req.body;

    try {
        console.log('📌 Nova inscrição recebida:', { nome, email, cpf });

        if (!nome || !email || !cpf || !endereco || !municipio) {
            return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
        }

        const cpfLimpo = cpf.replace(/[^\d]+/g, '');

        // 1. Grava/Atualiza no Neon
        const queryDB = `
            INSERT INTO alunos (nome, email, cpf, endereco, municipio, instituicao, cargo)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (cpf) DO UPDATE SET 
                nome = EXCLUDED.nome,
                email = EXCLUDED.email,
                endereco = EXCLUDED.endereco,
                municipio = EXCLUDED.municipio,
                instituicao = EXCLUDED.instituicao,
                cargo = EXCLUDED.cargo
            RETURNING id;
        `;
        const values = [nome, email, cpfLimpo, endereco, municipio, instituicao || '', cargo || ''];
        const dbRes = await db.query(queryDB, values);
        const alunoId = dbRes.rows[0].id;
        console.log(`✅ Registro gravado no Neon | Aluno ID #${alunoId}`);

        const hostUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

        //  Preço do curso 
        const VALOR_CURSO = 1.00; 

        // Preferência de Checkout Mercado Pago
        const preferenceData = {
            body: {
                items: [
                    {
                        title: 'Inscrição Curso MROSC na Prática',
                        unit_price: VALOR_CURSO,
                        quantity: 1,
                        currency_id: 'BRL',
                    }
                ],
                payer: {
                    name: nome,
                    email: email
                },
                external_reference: String(alunoId),
                back_urls: {
                    success: `${hostUrl}/inscricao.html?status=sucesso`,
                    failure: `${hostUrl}/inscricao.html?status=erro`,
                    pending: `${hostUrl}/inscricao.html?status=pendente`
                }
            }
        };

        const response = await preference.create(preferenceData);
        console.log('Checkout gerado com sucesso no Mercado Pago!');

        return res.json({ checkoutUrl: response.init_point });

    } catch (error) {
        console.error('❌ ERRO NO SERVIDOR:', error.message || error);
        if (error.cause) {
            console.error('Detalhes do erro MP:', JSON.stringify(error.cause, null, 2));
        }
        return res.status(500).json({ error: 'Erro ao gerar checkout do Mercado Pago.' });
    }
});

// -------------------------------------------------------------------
// ROTA WEBHOOK (Confirmação Automática)
// -------------------------------------------------------------------
app.post('/api/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;

        if (type === 'payment' || req.query.topic === 'payment') {
            const paymentId = data ? data.id : req.query.id;
            const payment = await new Payment(client).get({ id: paymentId });

            if (payment.status === 'approved') {
                const alunoId = payment.external_reference;
                await db.query(
                    `UPDATE alunos SET status_pagamento = 'aprovado' WHERE id = $1`,
                    [alunoId]
                );
                console.log(` Pagamento APROVADO para o aluno ID #${alunoId}`);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Erro no webhook:', error);
        res.sendStatus(500);
    }
});


// Rota para o painel admin listar todos os inscritos do Neon DB
app.get('/api/alunos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM alunos ORDER BY id DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar alunos:', err);
    res.status(500).json({ error: 'Erro no banco de dados' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(` Servidor de Produção rodando na porta ${PORT}`));