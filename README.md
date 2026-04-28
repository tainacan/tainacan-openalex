# Tainacan OpenAlex Bibliografia (Form Hook)

Plugin para **WordPress + Tainacan** que permite pesquisar referências bibliográficas no **OpenAlex** e preencher automaticamente metadados do item aberto no formulário administrativo do Tainacan.

A interface aparece dentro do formulário do item por meio do **Admin Form Hook** do Tainacan. O usuário pesquisa, clica em um resultado e o plugin preenche os campos mapeados. Depois disso, basta clicar em **Salvar** no item.

## O que o plugin faz

- adiciona um bloco **OpenAlex (Bibliografia)** no formulário de item do Tainacan;
- pesquisa obras no OpenAlex por:
  - **Busca livre**
  - **Título**
  - **Autor**
  - **DOI**
  - **ISSN**
- carrega os detalhes de uma obra selecionada;
- monta uma referência bibliográfica simples em formato **ABNT**;
- preenche metadados do item atual no Tainacan com base em um **mapeamento por ID de metadado**.

## Fluxo de uso

1. Abra o formulário de um item no admin do Tainacan.
2. No bloco **OpenAlex (Bibliografia)**, escolha o tipo de busca.
3. Digite a consulta e clique em **Buscar**.
4. Clique em um dos resultados retornados.
5. O plugin preenche os metadados mapeados.
6. Clique em **Salvar** no item.

## Estratégia de busca implementada

### 1. Busca livre
Usa busca textual no endpoint de obras do OpenAlex.

### 2. Título
Também usa busca textual em obras, mas com a opção “Título” separada na interface.

### 3. Autor
Faz a resolução em duas etapas:
1. busca o autor no endpoint `/authors`;
2. pega o **primeiro resultado** retornado;
3. busca as obras desse autor no endpoint `/works`.

### 4. DOI
Resolve o DOI diretamente no endpoint da obra.

### 5. ISSN
Resolve a source a partir do ISSN e, em seguida, busca as obras vinculadas à source encontrada.

## Estrutura do plugin

```text
.
├── tainacan-openalex-biblio.php
└── assets
    ├── openalex-biblio.js
    └── openalex-biblio.css
```

## Requisitos

- WordPress
- Tainacan instalado e ativo
- acesso ao admin do Tainacan
- permissão para editar posts (`edit_posts`)

## Instalação

### Opção 1: manual

1. Crie uma pasta no diretório de plugins do WordPress, por exemplo:
   `wp-content/plugins/tainacan-openalex-biblio`
2. Copie os arquivos do plugin para essa pasta.
3. Certifique-se de manter a estrutura:

```text
wp-content/plugins/tainacan-openalex-biblio/
├── tainacan-openalex-biblio.php
└── assets/
    ├── openalex-biblio.js
    └── openalex-biblio.css
```

4. Ative o plugin no painel do WordPress.

### Opção 2: ZIP

Compacte a pasta do plugin e envie pelo instalador de plugins do WordPress.

## Configuração no Tainacan

Depois de ativar o plugin, vá para as configurações do Tainacan e preencha a seção **OpenAlex Biblio**.

### Campos disponíveis na configuração

- **ID da Coleção de Referências**
- **OpenAlex API Key (opcional)**
- **Mapeamento: Title → Metadado (ID)**
- **Mapeamento: Authors → Metadado (ID)**
- **Mapeamento: Year → Metadado (ID)**
- **Mapeamento: DOI → Metadado (ID)**
- **Mapeamento: Venue → Metadado (ID)**
- **Mapeamento: URL → Metadado (ID)**
- **Mapeamento: Referência (ABNT) → Metadado (ID)**

## Mapeamento dos campos

O plugin usa os IDs dos metadados do item atual para preencher os valores retornados pelo OpenAlex.

### Campos suportados

| Origem OpenAlex | Destino no Tainacan |
|---|---|
| Título | metadado configurado em `openalex_map_title` |
| Autores | metadado configurado em `openalex_map_authors` |
| Ano | metadado configurado em `openalex_map_year` |
| DOI | metadado configurado em `openalex_map_doi` |
| Veículo / periódico | metadado configurado em `openalex_map_venue` |
| URL da obra | metadado configurado em `openalex_map_url` |
| Referência ABNT | metadado configurado em `openalex_map_abnt` |

## Como o preenchimento funciona

O frontend tenta localizar o componente Vue do metadado no formulário do Tainacan e aplica o valor usando uma combinação de:

- expansão do metadado, caso ele esteja recolhido;
- acesso ao proxy Vue quando disponível;
- atualização direta do campo HTML (`input`/`textarea`);
- disparo de eventos `input` e `change`;
- pequena espera entre os campos para reduzir perda de estado no formulário.

## Saída ABNT

O plugin gera uma referência ABNT básica com os dados abaixo, quando disponíveis:

- autores
- título
- veículo/periódico
- ano
- DOI
- URL
- data de acesso

### Regras atuais da montagem ABNT

- usa até **3 autores**;
- se houver mais de 3 autores, adiciona `et al.`;
- a montagem é simples e prática;
- não pretende cobrir todas as variações da norma ABNT.