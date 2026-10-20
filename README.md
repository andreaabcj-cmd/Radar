# Radar Diário

Meu jornal pessoal, escuro e minimalista, separado por temas. Atualiza sozinho a cada hora, sem IA.

## Como funciona

- `feeds.json` lista os sites (RSS) de cada tema. Para adicionar ou tirar um site, edite esse arquivo.
- `scripts/atualizar.mjs` busca as notícias e grava em `news.json`.
- `.github/workflows/atualizar.yml` faz o GitHub rodar o script a cada hora.
- `index.html` é o app. Os favoritos ficam salvos no próprio aparelho.

## Atualizar na hora

Aba **Actions** → **Atualizar notícias** → **Run workflow**.

## Fontes com problema

No fim da página do app, toque em "fontes funcionando" para ver quais sites falharam na última atualização.
