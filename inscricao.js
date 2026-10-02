document.addEventListener('DOMContentLoaded', () => {

    // 1. Trata o retorno do Mercado Pago após o pagamento (?status=sucesso)
    const urlParams = new URLSearchParams(window.location.search);
    const status = urlParams.get('status');
    const formInscricao = document.getElementById('form-inscricao');

    if (status === 'sucesso') {
        if (formInscricao) {
            formInscricao.innerHTML = `
                <div class="text-center py-10 px-4 space-y-4 bg-emerald-50 border border-emerald-200 rounded-2xl shadow-sm">
                    <div class="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full text-emerald-600 mb-2">
                        <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </div>
                    <h2 class="text-2xl font-bold text-[#0B3B36]">Inscrição Confirmada! 🎉</h2>
                    <p class="text-slate-700 max-w-md mx-auto text-base">
                        Seu pagamento foi aprovado com sucesso. Sua vaga no <strong>Curso MROSC na Prática</strong> está garantida.
                    </p>
                    <p class="text-xs text-slate-500">
                        O comprovante oficial de compra foi enviado pelo Mercado Pago para o seu e-mail.
                    </p>
                    <div class="pt-4">
                        <a href="/" class="inline-block bg-[#0B3B36] text-white font-medium px-6 py-2.5 rounded-lg hover:bg-opacity-90 transition">
                            Voltar ao Início
                        </a>
                    </div>
                </div>
            `;
        }
        return;
    } else if (status === 'erro') {
        alert(' Não foi possível concluir o pagamento. Por favor, tente novamente.');
    } else if (status === 'pendente') {
        alert(' Seu pagamento está em processamento. Assim que for compensado (Pix/Boleto), sua vaga será confirmada.');
    }

    // 2. Máscara de CPF
    const inputCPF = document.getElementById('cpf');
    if (inputCPF) {
        inputCPF.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);

            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');

            e.target.value = value;
        });
    }

    // 3. Função Principal de Envio e Redirecionamento
    async function processarInscricao(e) {
        if (e) e.preventDefault();

        const btnSubmit = document.getElementById('btn-pagamento');
        const textoOriginal = btnSubmit ? btnSubmit.innerHTML : 'Ir para Pagamento';

        const nome = document.getElementById('nome')?.value.trim();
        const email = document.getElementById('email')?.value.trim();
        const cpf = document.getElementById('cpf')?.value.trim();
        const endereco = document.getElementById('endereco')?.value.trim();
        const municipio = document.getElementById('municipio')?.value.trim();
        const instituicao = document.getElementById('instituicao')?.value.trim() || '';
        const cargo = document.getElementById('cargo')?.value.trim() || '';

        // Validação
        if (!nome || !email || !cpf || !endereco || !municipio) {
            alert(' Preencha todos os campos obrigatórios (*).');
            return;
        }

        const cpfLimpo = cpf.replace(/\D/g, '');
        if (cpfLimpo.length !== 11) {
            alert(' Informe um CPF válido com 11 dígitos.');
            return;
        }

        try {
            if (btnSubmit) {
                btnSubmit.disabled = true;
                btnSubmit.innerHTML = 'Gerando Pagamento...';
            }

            const response = await fetch('/api/inscricao', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nome,
                    email,
                    cpf: cpfLimpo,
                    endereco,
                    municipio,
                    instituicao,
                    cargo
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detalhe || data.error || 'Erro ao gerar pagamento no servidor.');
            }

            if (data.checkoutUrl) {
                // REDIRECIONA PARA O MERCADO PAGO
                window.location.href = data.checkoutUrl;
            } else {
                throw new Error('O servidor não retornou o link do checkout.');
            }

        } catch (error) {
            console.error(' Erro na inscrição:', error);
            alert(`Erro: ${error.message}`);

            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = textoOriginal;
            }
        }
    }

    // Associa tanto o evento de Submit do Form quanto o Clique do Botão por ID
    if (formInscricao) {
        formInscricao.addEventListener('submit', processarInscricao);
    }

    const btnPagamento = document.getElementById('btn-pagamento');
    if (btnPagamento) {
        btnPagamento.addEventListener('click', (e) => {
            // Se o botão for do tipo "button", dispara a função manualmente
            if (btnPagamento.type === 'button') {
                processarInscricao(e);
            }
        });
    }
});