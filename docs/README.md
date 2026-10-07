# Tainacan OpenAlex

Plugin para **WordPress + Tainacan** que pesquisa obras no **OpenAlex** e preenche metadados do item aberto no formulário administrativo do Tainacan.

A interface aparece no formulário do item pelo **Admin Form Hook** do Tainacan.

## Estrutura

```text
.
├── tainacan-openalex.php    # arquivo principal do plugin
├── readme.txt               # readme do WordPress.org
├── src/                     # código-fonte dos assets (não vai no zip)
│   ├── index.js
│   └── index.css
├── build/                   # assets gerados pelo build
│   ├── index.js
│   ├── index.css
│   ├── index-rtl.css
│   └── index.asset.php
└── package.json
```

Arquivos de desenvolvimento (`docs/`, `.gitignore`, `src/`, `package.json`) ficam fora do pacote enviado ao diretório de plugins. Gere esse pacote com `npm run plugin-zip`.

## Desenvolvimento

```bash
npm install
npm run build
```

`npm run start` recompila os assets enquanto você edita `src/`. A versão usada no `wp_enqueue_*` é lida do cabeçalho `Version` de `tainacan-openalex.php`.

## Requisitos

- WordPress
- Tainacan instalado e ativo
- permissão `tnc_col_{id}_edit_items` na coleção de referências configurada

## Instalação a partir do código

1. Rode `npm run build`.
2. O plugin já deve estar em `wp-content/plugins/tainacan-openalex/`.
3. Ative **Tainacan OpenAlex** no painel do WordPress.
4. Em **Tainacan → Configurações**, abra a seção **OpenAlex**.

Para um zip instalável, use `npm run plugin-zip`.

## Configuração

- **Coleção de referências**
- **OpenAlex API key** (opcional)
- Mapeamento dos campos título, autores, ano, DOI, periódico/veículo, URL e referência ABNT

O texto-fonte da interface está em inglês. A tradução para português do Brasil fica em `languages/` e é carregada quando o idioma do site é `pt_BR`.
