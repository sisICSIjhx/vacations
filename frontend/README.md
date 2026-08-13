# ICSI Vacaciones · Frontend

Panel administrativo React para visualizar vacaciones, coincidencias y disponibilidad del personal. Usa Supabase Auth y la Data API cuando existen variables de entorno; sin ellas inicia en modo demostración.

## Desarrollo

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Abre `http://localhost:3000`.

## Variables

Consulta `.env.example`. La clave publicable de Supabase puede llegar al navegador; la clave secreta pertenece únicamente a la API NestJS.

## Validación

```powershell
npm run lint
npm test
```

El proyecto usa Vinext para producir el artefacto compatible con Sites.
