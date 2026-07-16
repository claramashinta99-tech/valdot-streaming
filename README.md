# Valdot Streaming

Frontend dan API proxy Valdot berbasis Next.js 16, vinext, dan Cloudflare Workers.

## Persyaratan

- Node.js 22.13 atau lebih baru
- Akun Cloudflare
- Domain yang aktif di Cloudflare DNS untuk pemasangan custom domain otomatis

## Pengembangan lokal

```bash
npm install
npm run dev
```

## Validasi

```bash
npm run build
npm run deploy:dry
```

## Deploy manual ke Cloudflare Workers

```bash
npx wrangler login
npm run deploy
```

Setelah deploy pertama berhasil, buka **Workers & Pages → valdot-streaming → Settings → Domains & Routes**, lalu tambahkan `valdot.web.id` sebagai Custom Domain. Hapus record DNS lama yang masih menunjuk ke hosting sebelumnya.

## Deploy melalui GitHub Actions

Workflow `.github/workflows/deploy-cloudflare.yml` dijalankan manual dari tab **Actions**. Tambahkan dua repository secrets sebelum menjalankannya:

- `CLOUDFLARE_API_TOKEN` — token dengan template **Edit Cloudflare Workers**
- `CLOUDFLARE_ACCOUNT_ID` — ID akun dari dashboard Cloudflare

## Catatan penting

- Jangan commit `.env.local`, API token, atau credential lainnya.
- Sansekai demo API memiliki rate limit rendah; gunakan akses resmi dengan kuota yang sesuai untuk trafik publik.
- Folder `.openai` dipertahankan hanya sebagai metadata deployment lama dan tidak dibaca oleh konfigurasi Cloudflare.
