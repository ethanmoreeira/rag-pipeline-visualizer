# Embeddings, Busca Semântica e RAG

### Grupo 7 · RAG e Transformers

Apresentação interativa de um pipeline RAG, desde a preparação de uma base documental até a resposta gerada por uma LLM. Cada tela mostra uma transformação: texto, tokens, vetores, resultados da busca, evidências e contexto.

**Integrantes**:

- Ítalo Dias Moreira Campos
- Julyanne Lauriano Genevain
- Rakel Garcia da Silva
- Raphaell Reiff Galoni

## Sobre o projeto

O objetivo é abrir a “caixa-preta” do RAG e acompanhar o que acontece entre os documentos e a resposta. A interface permite inspecionar a preparação da Base, os estados produzidos pelo encoder, a comparação vetorial e os textos que chegam à LLM.

O domínio escolhido é **consumo residencial de energia elétrica**. A Base reúne dez sínteses locais em Markdown, preparadas a partir de conteúdos públicos. A procedência, as adaptações e as referências estão no [catálogo da Base](data/base/catalogo.json).

| Documento | Tema |
| --- | --- |
| D1 | Potência, tempo de uso e consumo |
| D2 | Composição da conta de energia |
| D3 | Bandeiras tarifárias |
| D4 | Eficiência energética e etiquetagem |
| D5 | Chuveiro elétrico |
| D6 | Ar-condicionado e climatização |
| D7 | Refrigeradores |
| D8 | Iluminação eficiente |
| D9 | Standby e outros aparelhos |
| D10 | Hábitos de economia |

O sistema utiliza MiniLM, Qdrant e Qwen em execução, com seus resultados apresentados pela aplicação. Quando a Base já está pronta, a interface relê os registros e mostra as etapas de preparação. Inspecionar um card ou acompanhar uma animação não executa novamente o modelo a cada clique.

## Arquitetura geral

O fluxo tem duas fases. Primeiro, os documentos são preparados e armazenados. Depois, a pergunta é representada, comparada à Base e respondida com apoio dos trechos recuperados.

```mermaid
flowchart TB
    subgraph base[Preparação da Base]
        D[10 documentos Markdown] --> L[Leitura, normalização e metadados]
        L --> C[Chunking: 350 caracteres, overlap até 60]
        C --> M[MiniLM + mean pooling + L2]
        M --> V[55 embeddings de 384 dimensões]
        V --> DB[(Qdrant: ID, vetor e payload)]
    end
    subgraph consulta[Processamento da consulta]
        Q[Pergunta do usuário] --> QM[Mesmo MiniLM + pooling + L2]
        QM --> QV[Embedding da consulta: 384D]
        QV --> S[Busca Cosine no Qdrant]
        S --> K[Ranking e top-k: 1 a 5]
        K --> R[Recuperação dos payloads por ID]
        R --> CT[Instrução + consulta + evidências]
        CT --> G[Qwen3-4B via llama.cpp]
        G --> A[Resposta com citações de chunks]
    end
    DB --> S
    DB --> R
    S --> P[PCA 2D: somente visualização]
```

| Componente | Responsabilidade |
| --- | --- |
| LangChain | Fornece ferramentas de carregamento e divisão do texto |
| MiniLM | Produz representações vetoriais dos textos |
| Qdrant | Armazena registros, compara vetores e recupera payloads |
| Cosine | Mede o alinhamento entre vetores |
| PCA | Projeta os vetores em dois eixos para o mapa |
| Qwen3-4B | Gera a resposta a partir do contexto recebido |
| llama.cpp | Executa a LLM localmente |
| Código da aplicação | Coordena as etapas, valida dados, monta o contexto e apresenta os resultados |

## Demonstração

As 18 capturas a seguir acompanham a preparação da Base, a consulta, a busca, a recuperação e a resposta. Elas permitem conhecer o funcionamento do projeto mesmo sem executar a aplicação.

O vídeo abaixo mostra o pipeline completo em funcionamento, desde a preparação da Base até a resposta gerada pelo Qwen.

[![Assistir à demonstração do pipeline](docs/images/00-01-base-visao-geral.png)](docs/media/demonstracao.mp4)

**Demonstração completa — 1min29s**

[Assistir à demonstração](docs/media/demonstracao.mp4) | [Baixar vídeo em MP4](https://raw.githubusercontent.com/ethanmoreeira/rag-pipeline-visualizer/main/docs/media/demonstracao.mp4)

## Pipeline passo a passo

A apresentação começa com uma capa não numerada, seguida pelas páginas **00–07**. As capturas abaixo documentam essas oito páginas. Nas telas de consulta em diante, o exemplo utilizado é:

> Se eu tomar banhos mais curtos, o consumo de energia diminui?

### 00 · Preparação da Base

#### Visão geral

Os dez documentos precisam ser preparados antes da busca. A página reúne as fontes e as etapas que transformam esses textos em registros pesquisáveis.

![Visão geral da Base com dez documentos e suas etapas](docs/images/00-01-base-visao-geral.png)

Cada documento mantém uma identificação, como D1 ou D5. A Base preparada contém **55 chunks**, cada um associado ao documento de origem.

#### Ingestão e parsing

Os arquivos estão armazenados localmente em **Markdown**. Markdown é o formato do arquivo; **UTF-8** é a codificação utilizada para ler seus caracteres, incluindo acentos.

![Leitura do arquivo D1 pelo TextLoader e organização como Document](docs/images/00-02-base-ingestao-parsing.png)

O `MultiFileLoader`, do LangChain, percorre os arquivos e utiliza `TextLoader` para cada `.md`. O resultado é um objeto `Document`: `pageContent` contém o texto, e `metadata.source` registra a origem local.

Aqui, **parsing é transformar a leitura do arquivo em uma estrutura que o programa consegue manipular**. O TextLoader não interpreta semanticamente o assunto nem extrai títulos e tabelas de Markdown. Nesse caminho, também não há extração de PDF ou navegação web durante a pergunta.

#### Normalização textual e metadados

A normalização padroniza Unicode, espaços, tabulações e quebras de linha. O texto original é preservado para comparação.

![Normalização textual de D1, com comparação antes e depois](docs/images/00-03-base-normalizacao-metadados.png)

A captura mostra o painel de normalização: D1 passa de **1.582 para 1.487 caracteres** pela padronização da formatação. Essa operação não resume o documento nem muda suas palavras e números. Ela é diferente da normalização L2 aplicada posteriormente aos vetores.

Na etapa de **metadados**, o código associa o texto à entrada correspondente do catálogo. Título, instituição, fonte, URL, categoria e adaptação vêm desse catálogo previamente preenchido. Caminho, tamanho e assinatura do arquivo são calculados ou registrados pela aplicação; não são descobertos pela LLM.

Os metadados permitem identificar a procedência de cada trecho. A assinatura ajuda a reconhecer uma versão do arquivo, mas não comprova a veracidade do conteúdo. O painel de metadados não está aberto nesta captura.

#### Chunking

O `RecursiveCharacterTextSplitter`, do LangChain, divide os textos normalizados em trechos menores. Ele tenta usar limites como parágrafos, linhas e espaços antes de recorrer a cortes menores.

![Mapa dos 55 chunks e inspeção dos cortes](docs/images/00-04-base-chunking.png)

Configuração utilizada:

```text
chunkSize = 350 caracteres
chunkOverlap = 60 caracteres, como limite configurado
10 documentos → 55 chunks
```

Um **chunk** é um trecho do documento. O **overlap** permite repetir parte do texto entre trechos vizinhos, reduzindo a perda de contexto na fronteira. A repetição efetiva pode ser menor que 60 ou não ocorrer, conforme os cortes encontrados; cada chunk também pode ter menos de 350 caracteres.

O código recebe os cortes produzidos pelo splitter, atribui IDs e calcula as posições no texto. `D3-C2`, por exemplo, identifica o segundo chunk do documento D3. O número do chunk não indica relevância.

Na imagem, o trecho selecionado acima é D3-C2; o detalhe de cortes aberto abaixo utiliza D1. O mapa avança automaticamente entre trechos, e uma seleção manual interrompe esse percurso. Essa animação percorre chunks disponíveis, sem dividir novamente o texto.

#### Embeddings dos chunks

Cada chunk é processado pelo **paraphrase-multilingual-MiniLM-L12-v2**, um encoder Transformer multilíngue. A execução local utiliza Transformers.js, ONNX q8 e WASM.

![55 embeddings da Base, com acesso ao vetor de D1-C1](docs/images/00-05-base-embeddings.png)

Um **embedding** é uma representação numérica que permite comparar relações semânticas entre textos. Depois dos estados contextualizados, do mean pooling e da normalização L2, cada chunk possui **um vetor de 384 dimensões**.

Os 55 vetores correspondem aos 55 chunks. Títulos, URLs e instituições acompanham os registros como metadados; o texto do chunk é a entrada utilizada para gerar seu embedding.

A representação aprendida pelo MiniLM permite a comparação semântica. O cosseno mede o alinhamento dessas representações; ele não cria o significado.

#### Indexação no Qdrant

O Qdrant guarda cada chunk como um registro chamado **point**.

![Point 1 do Qdrant com vetor 384D e payload de D1-C1](docs/images/00-06-base-indexacao-qdrant.png)

```text
1 chunk → 1 embedding → 1 point

point:
  ID numérico
  vector: embedding de 384 valores
  payload: texto e metadados
```

O ID numérico identifica o registro no banco. O ID legível, como `D1-C1`, identifica o chunk e também aparece nas citações.

> O vetor localiza; o payload devolve o conteúdo.

O código grava os registros numa coleção **384D / Cosine** e os relê para conferir quantidade, IDs, texto, metadados e vetores. Se a coleção atual já estiver válida, ela é reutilizada. Abrir as etapas de uma Base pronta mostra os dados preparados, sem nova indexação.

### 01 · Consulta

A pergunta começa como texto. Esta tela permite escolher uma das três sugestões ou confirmar uma pergunta livre.

![Opções de consulta e campo livre, antes da seleção](docs/images/01-01-consulta.png)

Para compará-la aos chunks, a consulta precisa passar pelo **mesmo MiniLM, pooling e normalização** utilizados na Base. Assim, as representações ficam no mesmo espaço vetorial. Apenas ter 384 números não torna vetores de modelos diferentes automaticamente comparáveis.

A captura está anterior à seleção. As imagens seguintes mostram a consulta sobre banhos mais curtos. Confirmar a pergunta define a entrada; a geração da resposta ocorre mais adiante.

### 02 · Embedding da consulta

#### Tokens e IDs

O **tokenizer** divide a consulta em unidades que o modelo processa. Um token pode ser uma palavra, parte de palavra, pontuação ou marcador especial.

![17 tokens e seus IDs na consulta sobre banhos mais curtos](docs/images/02-01-embedding-tokens-ids.png)

Nesta consulta aparecem **17 tokens**, incluindo os marcadores especiais `<s>` e `</s>`. Cada token possui um ID no vocabulário. Esse ID é um identificador, não uma medida de significado e nem o ID do chunk no Qdrant.

#### MiniLM e estados contextualizados

O MiniLM usa relações entre tokens e informação de posição para produzir representações que consideram o contexto. A **self-attention** permite que a representação de um token leve em conta os demais tokens da frase.

![Estados contextualizados dos tokens, com uma amostra das coordenadas](docs/images/02-02-embedding-minilm-estados-contextualizados.png)

O resultado tem a forma:

```text
17 tokens → 17 vetores de 384 dimensões
```

A captura mostra o card de **estados contextualizados**: três coordenadas por linha são uma amostra de uma matriz maior. A inspeção permite percorrer as 384 dimensões. Os valores vêm da saída contextualizada do encoder; cada coordenada não possui um rótulo fixo, como “preço” ou “chuveiro”.

#### Mean pooling e normalização L2

A busca precisa de um vetor para a consulta inteira. O **mean pooling** calcula uma média em cada dimensão dos vetores de tokens válidos.

![Mean pooling, máscara de participação e média antes da normalização](docs/images/02-03-embedding-mean-pooling-l2.png)

A **attention mask** informa quais posições entram nessa média: 1 participa; 0 fica fora, como padding usado para completar sequências. Ela não é uma porcentagem de importância de cada palavra. Na captura, as 17 posições têm máscara 1, incluindo os tokens especiais.

```text
17 vetores × 384D → média por dimensão → 1 vetor × 384D
```

Em seguida, a **normalização L2** divide cada coordenada pelo comprimento do vetor, sua norma Euclidiana. A direção é preservada e a norma passa a ser aproximadamente 1.

```text
norma L2 = raiz da soma dos quadrados das coordenadas
coordenada normalizada = coordenada / norma L2
```

Essa normalização altera a escala do vetor; a normalização textual da Base padroniza a formatação. A imagem mostra a média antes da normalização, enquanto L2 é a operação seguinte da interface.

#### Vetor final de 384 dimensões

A consulta agora possui um único embedding normalizado, pronto para ser comparado com os 55 embeddings da Base.

![Embedding 384D da consulta e acesso às coordenadas completas](docs/images/02-04-embedding-vetor-384d.png)

Os quatro valores destacados são uma amostra; o botão permite abrir os **384 valores**. Os sete cards mostram partes do resultado de uma passagem pelo MiniLM, sem executar uma inferência nova para cada card.

### 03 · Busca semântica

O vetor da consulta é enviado à API da aplicação. O servidor valida sua dimensão, modelo e norma e solicita ao Qdrant uma busca **exata com Cosine** na coleção atual.

![PCA 2D e ranking top-5 recebido do Qdrant](docs/images/03-01-busca-semantica.png)

O Qdrant compara os vetores completos e devolve o ranking dos 55 chunks. A interface preserva essa ordem; não há reranker no pipeline final.

- **MiniLM:** produziu representações semânticas.
- **Qdrant:** executou a comparação e devolveu o ranking.
- **Cosine:** foi a métrica de comparação.

O Qdrant recebe números para comparar. A semântica está na representação aprendida pelo encoder, não numa interpretação da frase pelo banco.

#### Por que existe o mapa PCA?

**PCA** significa *Principal Component Analysis*, ou **Análise de Componentes Principais**. O código projeta consulta e chunks em dois eixos que preservam parte da variação do conjunto, permitindo desenhar dados originalmente representados em 384 dimensões.

O mapa tem **56 pontos: uma consulta e 55 chunks**. Os eixos não são temas nomeados. A redução perde informação, e a distância no desenho não equivale ao score completo.

> PCA 2D é apenas visualização. O ranking é calculado pelo Qdrant nos embeddings 384D.

O detalhe da interface informa a variância preservada pelos dois eixos, que depende dos dados da consulta. Esse percentual não é acurácia nem confiança da resposta. Os destaques progressivos revelam o ranking recebido; não realizam a busca ponto a ponto.

### 04 · Similaridade cosseno e top-k

O cosseno mede o **alinhamento entre as direções de dois vetores**. Quanto maior o score dentro dessa representação, mais alinhados estão a consulta e o chunk.

![Fórmula de Cosine, diagrama do ângulo, ranking e seletor top-k](docs/images/04-01-similaridade-cosseno-topk.png)

Na fórmula, **Q** é o vetor da consulta e **D** é o vetor do chunk:

```text
Cosine(Q, D) = produto escalar(Q, D) / (norma(Q) × norma(D))
```

O produto escalar multiplica coordenadas correspondentes e soma os resultados. As normas são os comprimentos dos vetores. Com vetores de norma 1, o produto escalar coincide com Cosine, salvo diferenças de arredondamento.

O valor matemático fica entre -1 e 1. **Um score de 0,75 não significa 75% de confiança nem garante que o trecho responda à pergunta.**

O ranking ordena os scores; **top-k** seleciona os primeiros k itens. O padrão é 5, e a interface permite escolher **1, 2, 3, 4 ou 5**. A captura mostra top-5, com D5-C3, D5-C2, D5-C4, D1-C4 e D10-C1: cinco chunks de três documentos.

Alterar k conserva embedding e ranking, mas limpa recuperação, contexto e resposta para que as etapas seguintes usem a nova seleção. O diagrama do ângulo ilustra o score; ele é diferente da projeção PCA e da atenção do Transformer.

### 05 · Recuperação dos payloads

A busca encontrou e ordenou candidatos. Agora o código usa os IDs numéricos dos points selecionados para fazer **uma nova requisição ao Qdrant**.

![Cinco chunks recuperados, com seus textos, IDs e acesso aos metadados](docs/images/05-01-recuperacao-payload.png)

```text
Top-k IDs → requisição da aplicação → Qdrant → payloads → textos
```

O Qdrant recupera os registros; **payload é o conteúdo devolvido, não o componente que executa retrieval**. Ele contém o texto e os metadados associados, como título, documento, origem e fonte. A aplicação mantém a ordem do ranking.

O texto já estava armazenado. Ele não é reconstruído ou “traduzido de volta” a partir do vetor. Os botões **Texto e metadados** permitem abrir o conteúdo completo e a referência da fonte; esses detalhes não estão abertos na captura.

No caminho interno, a API também recebe payloads na busca para validar os dados, mas a resposta dessa etapa enviada à interface contém IDs, títulos, scores e vetores. A recuperação dos textos selecionados é uma etapa separada, por ID.

Essa obtenção das evidências corresponde ao **Retrieval** do RAG.

### 06 · Contexto aumentado e LLM

#### Montagem do contexto

O código da aplicação organiza a entrada da geração: **instrução + consulta + evidências recuperadas**.

![Consulta e cinco evidências no contexto, antes da geração](docs/images/06-01-contexto-aumentado.png)

A instrução é definida no código. Ela pede uma resposta em português baseada nas evidências, com citações dos chunks, preservação de unidades e reconhecimento quando a Base não sustenta a pergunta. A consulta e os textos recuperados variam em cada execução.

Nesse exemplo, cinco chunks compõem as evidências. O tamanho mostrado, **2.066 caracteres**, corresponde ao conteúdo USER montado; não é uma contagem de tokens nem o tamanho total com a instrução SYSTEM.

#### Conteúdo textual enviado ao Qwen

O modal permite inspecionar o conteúdo das mensagens **SYSTEM** e **USER** utilizadas na chamada.

![Modal com instrução SYSTEM, consulta USER e parte das evidências JSON](docs/images/06-02-contexto-bruto-enviado-qwen.png)

A captura mostra parte desse conteúdo, que pode ser percorrido com rolagem. O modelo recebe as mensagens estruturadas, e o llama.cpp aplica o template de chat. Os delimitadores internos desse template não aparecem no modal.

Cada evidência enviada ao Qwen contém `id`, `documentId`, `title` e `text`. Vetores, scores e URLs não entram nesse contexto; os demais metadados continuam disponíveis no payload e nos detalhes da interface.

> O Qwen recebe texto. Os embeddings 384D já cumpriram sua função na busca.

#### Geração e conferência da resposta

O **Qwen3-4B**, no arquivo quantizado **Qwen3-4B-Q4_K_M.gguf**, gera a resposta localmente por meio do **llama.cpp**.

![Resposta do Qwen3-4B com citações das evidências utilizadas](docs/images/06-03-qwen-resposta.png)

Na captura, a resposta utiliza D5-C3 e D1-C4. Ela pode citar somente parte dos cinco chunks recuperados, conforme a informação usada.

O código verifica se os IDs citados pertencem ao contexto. Isso permite voltar aos trechos, mas **não comprova automaticamente a fidelidade de cada afirmação**. É preciso ler as evidências e conferir condições, unidades e conclusões.

A saída chega progressivamente por streaming. Texto interrompido é tratado como parcial; a resposta só é marcada como concluída após o término correto da geração. O tempo exibido na captura pertence àquela execução, sem representar uma garantia de desempenho.

RAG fornece apoio documental e pode reduzir alucinações, mas não impede todos os erros da LLM.

### 07 · Isso é RAG

O fechamento reúne os resultados das etapas anteriores, sem fazer outra busca ou geração.

![Fechamento com recuperação, contexto aumentado e geração](docs/images/07-01-isso-e-rag.png)

**RAG** significa *Retrieval-Augmented Generation*, ou **geração aumentada por recuperação**.

- **Retrieval:** recuperar os chunks selecionados.
- **Augmentation:** acrescentar essas evidências ao contexto da consulta.
- **Generation:** gerar a resposta com o Qwen usando esse contexto.

O card **Augmented Context** mostra a ampliação do contexto. Consultar os documentos não treina os modelos novamente nem modifica seus pesos.

Primeiro representamos o conhecimento, depois encontramos a informação relevante e, por fim, usamos essa informação para gerar uma resposta contextualizada.

## Arquitetura técnica

A interface coordena o percurso da apresentação. O trabalho fica distribuído entre o navegador, a API da aplicação e os dois serviços externos à interface.

| Camada | Onde executa | Função |
| --- | --- | --- |
| React e controlador Guided | Navegador | Controlam páginas, seleções, estados e inspeções |
| Workers do MiniLM | Navegador | Executam o encoder ONNX com WASM e produzem vetores |
| API da aplicação | Node.js, integrada ao servidor Vite | Lê arquivos, prepara a Base, valida dados e intermedeia operações do Qdrant |
| Qdrant | Serviço configurado no ambiente | Armazena points e executa busca Cosine e recuperação por ID |
| llama.cpp | Processo local | Carrega o arquivo GGUF e atende às chamadas do Qwen |

O Qdrant pode estar numa instalação própria ou no Qdrant Cloud. O iniciador da apresentação não instala nem inicia esse serviço. A chave de acesso fica no servidor da aplicação, sem ser enviada como configuração do navegador.

A geração passa pela integração da aplicação com o llama.cpp. Antes da chamada, o código aplica o template de chat e conta os tokens da entrada. Se entrada e reserva de resposta excederem a janela configurada, a operação é recusada, sem cortar silenciosamente os chunks.

O controlador mantém a sequência das operações. Trocar a pergunta descarta os resultados dependentes dela; trocar top-k preserva o ranking e exige nova recuperação e geração. As animações apresentam resultados disponíveis, enquanto as operações com modelos e banco acontecem nas etapas correspondentes.

## Tecnologias utilizadas

| Tecnologia | Uso no projeto |
| --- | --- |
| React 19, TypeScript 6 e Vite 8 | Interface, tipos e servidor de desenvolvimento com API integrada |
| LangChain Classic e Text Splitters | `MultiFileLoader`, `TextLoader`, `Document` e `RecursiveCharacterTextSplitter` |
| Hugging Face Transformers.js 3 | Tokenização, execução do encoder, pooling e normalização |
| ONNX Runtime / WASM | Execução do MiniLM no navegador |
| paraphrase-multilingual-MiniLM-L12-v2 | Encoder multilíngue, com saída de 384 dimensões |
| Qdrant | Coleção vetorial, busca exata Cosine e recuperação de payloads |
| PCA implementado na aplicação | Projeção para o mapa 2D |
| Qwen3-4B-Q4_K_M.gguf | Modelo quantizado utilizado na geração |
| llama.cpp | Servidor local da LLM |
| Lucide React | Ícones da interface |
| Node.js Test Runner e Oxlint | Testes automatizados e análise de código |
| pnpm | Gerenciamento de dependências e execução dos scripts |

As versões declaradas estão no [package.json](package.json); a resolução das dependências está no [pnpm-lock.yaml](pnpm-lock.yaml). LangChain é uma biblioteca de integração, não um modelo. BERT, GPT e T5 aparecem na fundamentação da disciplina, mas não são componentes executados neste pipeline.

## Estrutura do repositório

Árvore resumida dos arquivos e diretórios relevantes:

```text
rag-embeddings-interactive-presentation/
├── data/base/                 # 10 documentos Markdown e catálogo de procedência
├── docs/images/               # 18 capturas usadas neste README
├── public/                    # Identidade visual e recursos públicos da interface
├── scripts/
│   ├── start-presentation.mjs # Iniciador da apresentação e do Qwen
│   ├── setup-local-assets.mjs # Prepara arquivos locais do runtime WASM
│   ├── download-qwen4b.mjs    # Obtém e verifica o GGUF do Qwen3-4B
│   ├── validation-runtime.mjs # Recursos compartilhados das validações
│   ├── verify-online.mjs
│   ├── verify-presentation.mjs
│   ├── verify-retrieval.mjs
│   └── verify-base-ui.mjs
├── server/                   # Ingestão, API da Base, Qdrant e API de consulta
├── src/
│   ├── ai/                   # Matemática vetorial e integração com a LLM
│   ├── guided/
│   │   ├── base/             # Preparação e visualização da Base
│   │   └── online/           # Embedding, busca, recuperação, contexto e geração
│   ├── App.tsx
│   └── main.tsx
├── .env.example
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── vite.config.ts
└── README.md
```

Os testes ficam próximos aos componentes e módulos que verificam. Os modelos e o runtime da LLM são preparados localmente e ficam fora do versionamento.

## Como executar localmente

O ambiente utilizado na validação foi **Windows, Node.js 24.14.1 e pnpm 11.19.0**. O comando de apresentação usa `llama-server.exe`, portanto a inicialização descrita aqui corresponde ao Windows.

### 1. Obter o projeto e instalar dependências

```powershell
git clone https://github.com/ethanmoreeira/rag-pipeline-visualizer.git
cd rag-pipeline-visualizer
```

O comando de instalação com o lockfile sincronizado é:

```powershell
pnpm install --frozen-lockfile
```

A instalação dispara `setup-local-assets.mjs`. Esse script copia os arquivos WASM necessários das dependências instaladas e pode criar o nome `model_quantized.onnx` a partir de um `model_q8.onnx` já presente. **Ele não baixa o MiniLM, o Qwen ou o llama.cpp.**


### 2. Configurar o ambiente e o Qdrant

Crie a configuração local a partir do [modelo de ambiente](.env.example):

```powershell
Copy-Item .env.example .env
```

Preencha os valores da sua instalação:

```dotenv
QDRANT_URL=https://SEU-CLUSTER.REGIAO.cloud.qdrant.io
QDRANT_API_KEY=
```

`QDRANT_URL` é o endereço do serviço. `QDRANT_API_KEY` é a credencial da instalação, quando exigida. Reinicie o servidor da apresentação depois de alterar essas variáveis.

O serviço precisa estar acessível para preparar, consultar ou recuperar a Base. A aplicação confere a coleção existente antes de reutilizá-la; uma Base ausente precisa ser preparada pela página 00. Não é necessário excluir uma coleção válida para apresentar novamente.

### 3. Preparar o MiniLM local

Utilize os arquivos do [export ONNX do MiniLM mantido por Xenova](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/main), preservando esta estrutura local:

```text
public/models/paraphrase-multilingual-MiniLM-L12-v2/
├── config.json
├── special_tokens_map.json
├── tokenizer_config.json
├── tokenizer.json
└── onnx/
    └── model_quantized.onnx
```

O arquivo [model_quantized.onnx](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/blob/main/onnx/model_quantized.onnx) é o encoder q8 utilizado. O nome da pasta local não inclui um diretório adicional `Xenova`.

Após instalar as dependências, os arquivos do runtime também podem ser preparados explicitamente:

```powershell
node scripts/setup-local-assets.mjs
```

A mensagem de conclusão desse script confirma a preparação do runtime WASM, não a presença de todos os arquivos do modelo. Os workers utilizam somente os modelos locais; não há fallback automático para download remoto.

### 4. Preparar llama.cpp e Qwen

Obtenha o pacote Windows x64 para CPU nas [releases oficiais do llama.cpp](https://github.com/ggml-org/llama.cpp/releases). A instalação local examinada utiliza a release `b10793`. Extraia o executável e as bibliotecas acompanhantes em:

```text
.runtime/llama/
    llama-server.exe
    bibliotecas DLL do mesmo pacote
```

O modelo gerador fica em:

```text
.runtime/models/Qwen3-4B-Q4_K_M.gguf
```

O projeto possui um script específico para obter esse modelo:

```powershell
node scripts/download-qwen4b.mjs
```

Ele usa o repositório oficial `Qwen/Qwen3-4B-GGUF`, com revisão fixada no código, e verifica tamanho, assinatura GGUF e SHA-256. O arquivo esperado tem aproximadamente 2,5 GB. Se já existir, o script confere sua integridade. O iniciador não executa esse download automaticamente.

### 5. Iniciar a apresentação

Com dependências, modelos, runtime e Qdrant preparados, execute na pasta do projeto:

```powershell
pnpm --config.verify-deps-before-run=false run apresentar
```

O script `apresentar` é o iniciador oficial. A opção acima permite utilizar o ambiente já instalado sem acionar a sincronização automática de dependências do pnpm 11. Com a configuração e o lockfile alinhados, o comando habitual é `pnpm run apresentar`.

O iniciador verifica o Qwen, inicia o serviço quando necessário e abre a interface. A interface utiliza a porta **5173**; o servidor da LLM utiliza **8082**. Serviços compatíveis já em execução são reutilizados. `Ctrl+C` encerra somente os processos iniciados por esse comando.

Para iniciar sem abrir automaticamente o navegador:

```powershell
node scripts/start-presentation.mjs --no-open
```

Percurso da apresentação: **00 Base → 01 Consulta → 02 Embedding → 03 Busca Semântica → 04 Similaridade → 05 Recuperação → 06 Contexto e LLM → 07 Isso é RAG**.

## Configuração do ambiente e arquivos locais

| Item | Tratamento |
| --- | --- |
| `.env.example` | Modelo de configuração, pode ser versionado |
| `.env` e chaves de acesso | Configuração privada, ignorada pelo Git |
| `public/models/` e `public/runtime/` | Modelos e recursos locais, ignorados |
| `.runtime/` | llama.cpp, GGUF e saídas de validação local, ignorados |
| `node_modules/`, `dist/` e `.cache/` | Dependências e arquivos gerados, ignorados |
| `docs/images/` | Capturas da documentação, incluídas na entrega |

As regras estão no [.gitignore](.gitignore). Um clone do código não inclui os modelos, as dependências instaladas ou a configuração privada do Qdrant. O projeto não exige uma chave da API da OpenAI para executar seu pipeline atual.

## Modelos utilizados

| Modelo | Entrada e saída | Papel |
| --- | --- | --- |
| paraphrase-multilingual-MiniLM-L12-v2, export ONNX q8 | Texto → estados de tokens → pooling → vetor 384D normalizado | Representação da Base e da consulta |
| Qwen3-4B, GGUF Q4_K_M | Instrução, pergunta e evidências textuais → resposta | Geração com contexto recuperado |

**q8** e **Q4_K_M** identificam formas de quantização de pesos: reduzem o tamanho e o uso de memória, com possíveis diferenças numéricas em relação aos pesos de maior precisão. Não são a dimensão do embedding nem uma contagem de tokens.

O projeto usa modelos previamente treinados. A indexação cria vetores e registros; a recuperação acrescenta conteúdo à entrada da LLM. Nenhuma dessas operações realiza fine-tuning.

Configuração atual da geração: **janela local de 4.096 tokens**, reserva de até **320 tokens de saída**, temperatura **0** e modo de thinking desativado. A janela configurada no runtime é diferente do limite máximo anunciado para a família do modelo. Temperatura zero não garante correção factual.

O caminho do MiniLM rejeita entradas acima de **128 tokens**, incluindo marcadores especiais, em vez de truncá-las silenciosamente. Caracteres do splitter e tokens do modelo são unidades diferentes.

## Testes e validações

Validações executadas no projeto local em **30/09/2026**, utilizando as dependências existentes:

| Verificação | Resultado |
| --- | --- |
| TypeScript / typecheck | Aprovado |
| Oxlint | Aprovado |
| Testes automatizados | **44 aprovados, 0 falhas** |
| Build de produção com Vite | Aprovado |
| Documentação visual | 18 capturas organizadas por etapa, com caminhos relativos |

Comandos utilizados:

```powershell
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run lint
pnpm --config.verify-deps-before-run=false run test
pnpm --config.verify-deps-before-run=false run build
```

Os testes incluem preparação e ingestão da Base, requisições, cálculo vetorial, estados do controlador e transições do fluxo. Parte desses testes usa dados controlados e serviços simulados. O lint configurado analisa `src`.

Esses resultados confirmam as verificações executadas, mas não equivalem a uma instalação em outra máquina ou a uma nova geração completa em todas as perguntas. As imagens documentam a execução capturada; o tempo e a resposta podem variar em outro ambiente.

### Verificações de integração disponíveis

Com a apresentação e os serviços preparados, existem scripts para conferir o pipeline:

```powershell
node scripts/verify-online.mjs --wasm
node scripts/verify-retrieval.mjs
node scripts/verify-presentation.mjs
```

| Script | Escopo |
| --- | --- |
| `verify-online.mjs --wasm` | MiniLM/WASM, ranking, top-k, recuperação, contexto, geração e tratamento de erros |
| `verify-retrieval.mjs` | Conjunto de consultas para examinar a recuperação, sem geração pelo Qwen |
| `verify-presentation.mjs` | Consultas dentro e fora do domínio, geração, citações e encerramento do streaming |
| `verify-base-ui.mjs` | Inspeção automatizada da Base no navegador; depende de Edge e de uma instalação de Playwright disponível no ambiente |

Os três primeiros comandos precisam do servidor da aplicação e do Qdrant configurado; os que geram respostas também precisam do Qwen. A opção `--wasm` seleciona o caminho WASM no verificador online. Saídas produzidas em `.runtime/` permanecem locais. Esses scripts não foram reexecutados como parte desta edição do README.

O build gera os arquivos da interface. A execução completa depende também da API e dos serviços: abrir apenas os arquivos de `dist` não inicia Qdrant, a API ou o Qwen.

## Limitações

- **Base pequena e específica:** dez sínteses sobre consumo residencial. O catálogo identifica adaptações e exemplos numéricos; não é uma base de tarifas atualizada automaticamente.
- **Recuperação limitada:** top-k entre 1 e 5, sem reranker. Um score alto não garante relevância suficiente nem cobertura completa da pergunta.
- **Visualização reduzida:** PCA perde informação e serve apenas ao mapa. O ranking usa os vetores 384D.
- **Resposta precisa de revisão:** RAG pode reduzir alucinações, mas o modelo ainda pode interpretar mal uma evidência. Validar um ID citado não valida todas as afirmações.
- **Dependência de serviços:** a busca e a recuperação exigem Qdrant acessível; a geração exige o modelo e o servidor llama.cpp locais.
- **Limites de entrada e desempenho:** encoder, janela de contexto, reserva de saída e recursos da máquina limitam o processamento. A velocidade observada não é garantida em outro computador.
- **Recursos locais não versionados:** a execução completa depende da correta preparação manual de configurações e artefatos externos que não acompanham o repositório, como o modelo Qwen GGUF, o ambiente llama.cpp, os arquivos locais do MiniLM, as credenciais do Qdrant e a capacidade de processamento da máquina.

## Referências

### Materiais da disciplina

- **Ementa de RAG e Transformers**, Bacharelado em Inteligência Artificial, 4º período, UniAcademia. Conteúdos de Transformers, BERT, GPT e T5 na p. 2; orientação sobre uso de IA na p. 3.
- **Seminário — Do Transformer aos Modelos OpenAI** (`Seminario.pdf`), material da disciplina. Tempo de apresentação na p. 1; tema do Grupo 7 e percurso embeddings, similaridade, recuperação, contexto e LLM nas pp. 4–5.
- **Tokens, embeddings e codificação posicional**, material da disciplina: tokens e IDs nas pp. 5–11, vetores nas pp. 12–14 e posição nas pp. 15–18.
- **Conectando LLMs ao conhecimento externo**, material da disciplina: RAG nas pp. 5–12, limitações nas pp. 13–14 e comparação com fine-tuning nas pp. 15–20.
- VASWANI, Ashish et al. **Attention Is All You Need**. *Advances in Neural Information Processing Systems*, 2017. [Artigo original](https://arxiv.org/abs/1706.03762).

Os materiais da disciplina fundamentam o trabalho. A documentação das bibliotecas e dos modelos complementa a explicação da implementação. BERT, GPT e T5 são referências teóricas; os modelos executados aqui são MiniLM e Qwen.

### Modelos, bibliotecas e serviços

- Sentence Transformers. [paraphrase-multilingual-MiniLM-L12-v2: model card](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2).
- Xenova. [Arquivos e export ONNX do MiniLM](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/main).
- Hugging Face. [Transformers.js](https://huggingface.co/docs/transformers.js).
- LangChain. [TextLoader](https://docs.langchain.com/oss/javascript/integrations/document_loaders/file_loaders/text) e [RecursiveCharacterTextSplitter](https://docs.langchain.com/oss/javascript/integrations/splitters/recursive_text_splitter).
- Qdrant. [Points](https://qdrant.tech/documentation/concepts/points/), [busca vetorial](https://qdrant.tech/documentation/concepts/search/) e [payload](https://qdrant.tech/documentation/concepts/payload/).
- Qwen. [Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B) e [distribuição GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF).
- ggml-org. [llama.cpp](https://github.com/ggml-org/llama.cpp).
- OpenAI. [Embeddings](https://developers.openai.com/api/docs/guides/embeddings), como referência complementar do conceito, sem utilização de seus modelos no pipeline atual.

### Procedência da Base

O [catálogo](data/base/catalogo.json) registra instituições, títulos, URLs, datas de acesso e adaptações dos dez textos. As duas URLs utilizadas no catálogo são:

- EPE. [Eficiência energética](https://www.epe.gov.br/pt/abcdenergia/eficiencia-energetica).
- ANEEL. [Bandeiras tarifárias](https://www.gov.br/aneel/pt-br/assuntos/tarifas/bandeiras-tarifarias).

Os documentos são sínteses locais, e não cópias integrais dessas páginas. O catálogo registra acesso em **18/09/2026** e identifica valores ilustrativos quando aplicável. Durante a consulta, o sistema recupera os textos armazenados, sem acessar essas páginas novamente.

## Nota acadêmica sobre uso de IA

Foram utilizadas ferramentas de IA da **OpenAI (ChatGPT GPT-5.6 Sol e Codex)** e do **Google (Gemini 3.1 Pro)** como apoio à organização, revisão técnica e documentação do projeto. As decisões de arquitetura, implementação, conteúdo e validação permaneceram sob responsabilidade dos integrantes.

