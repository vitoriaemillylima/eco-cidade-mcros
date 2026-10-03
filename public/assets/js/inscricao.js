document.addEventListener('DOMContentLoaded', () => {
    const formInscricao = document.getElementById('form-inscricao');
    if (formInscricao) {
        formInscricao.addEventListener('submit', processarInscricao);
    }
});

async function processarInscricao(e) {
    e.preventDefault();

    const btnSubmit = document.getElementById('btn-pagamento');
    const textoOriginal = btnSubmit ? btnSubmit.innerHTML : 'Ir para Pagamento';

    const nome = document.getElementById('nome')?.value.trim();
    const email = document.getElementById('email')?.value.trim();
    const cpf = document.getElementById('cpf')?.value.trim();
    const endereco = document.getElementById('endereco')?.value.trim();
    const municipio = document.getElementById('municipio')?.value.trim();
    const instituicao = document.getElementById('instituicao')?.value.trim() || '';
    const cargo = document.getElementById('cargo')?.value.trim() || '';
    
    // Pega a quantidade selecionada no <select> do HTML
    const quantidade = document.getElementById('quantidade')?.value || 1;

    if (!nome || !email || !cpf || !endereco || !municipio) {
        alert('Preencha todos os campos obrigatórios (*).');
        return;
    }

    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
        alert('Informe um CPF válido com 11 dígitos.');
        return;
    }

    try {
        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = 'Gerando Pagamento... ⏳';
            btnSubmit.classList.add('opacity-75', 'cursor-not-allowed');
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
                cargo, 
                quantidade 
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao gerar pagamento.');
        }

        if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
        } else {
            throw new Error('O servidor não retornou o link.');
        }

    } catch (error) {
        console.error('Erro:', error);
        alert(`Erro: ${error.message}`);

        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = textoOriginal;
            btnSubmit.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    }
}