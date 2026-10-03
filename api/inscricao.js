const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 5
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // AGORA SIM: Puxa a quantidade enviada pelo formulário!
  const { nome, email, cpf, endereco, municipio, instituicao, cargo, quantidade: qtdInput } = req.body;
  const quantidade = parseInt(qtdInput) || 1;
  const mpToken = process.env.MP_ACCESS_TOKEN;

  if (!mpToken) {
    return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });
  }

  // Regra de preço fixa dos pacotes
  let valorTotal = 90.00;

  if (quantidade > 20) {
      valorTotal = 650.00; // Pacote Master (>20)
  } else if (quantidade === 20) {
      valorTotal = 700.00; // Pacote Turma (20)
  } else if (quantidade >= 10) {
      valorTotal = 800.00; // Pacote Grupo (10)
  } else {
      valorTotal = 90.00; // Individual (1)
  }

  try {
    // Salva no banco incluindo a quantidade e o valor total
    const query = `
      INSERT INTO alunos (nome, cpf, endereco, municipio, instituicao, cargo, email, quantidade, valor_total, status_pagamento, data_inscricao)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente', NOW())
      RETURNING id;
    `;
    const values = [
      nome, 
      cpf?.replace(/\D/g, ''), 
      endereco, 
      municipio, 
      instituicao, 
      cargo, 
      email?.toLowerCase(), 
      quantidade, 
      valorTotal
    ];
    
    const dbResult = await pool.query(query, values);
    const alunoId = dbResult.rows[0].id;

    // Envia para o Mercado Pago cobrando o valor fechado do pacote
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mpToken}`
      },
      body: JSON.stringify({
        items: [{ 
          title: `Inscrição Curso MROSC (${quantidade} vaga(s) - Pacote Fechado)`, 
          unit_price: valorTotal, 
          quantity: 1, 
          currency_id: 'BRL' 
        }],
        payer: { name: nome, email: email, identification: { type: 'CPF', number: cpf?.replace(/\D/g, '') } },
        external_reference: alunoId.toString(),
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
      throw new Error(mpData.message || 'Erro ao gerar checkout');
    }

    return res.status(200).json({ success: true, checkoutUrl: mpData.init_point });
  } catch (err) {
    console.error('Erro na API:', err);
    return res.status(500).json({ error: 'Erro ao gerar pagamento', detalhe: err.message });
  }
};