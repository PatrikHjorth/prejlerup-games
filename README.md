# Prejlerup Games

Deploy-klar Next.js + Supabase webapp.

## Opsætning
1. Opret et Supabase-projekt.
2. Kør `supabase/schema.sql` i Supabase SQL Editor.
3. Opret en bruger i appen, og gør vedkommende til admin i SQL Editor:
   `update public.profiles set is_admin=true where display_name='DIT NAVN';`
4. Kopiér `.env.example` til `.env.local` og indsæt Supabase URL og publishable key.
5. Kør `npm install` og `npm run dev`.
6. Upload projektet til GitHub og importér det i Vercel. Tilføj de samme miljøvariabler i Vercel.

## Bemærkning om notifikationer
Denne version har beskeder inde i appen i realtid. Push-notifikationer på låseskærmen kræver VAPID-nøgler, service worker og en push-service og kan tilføjes som næste trin.
