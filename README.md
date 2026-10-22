# ICSI Vacaciones

Panel administrativo inspirado en la claridad operativa de absentify para visualizar vacaciones, coincidencias de personal y saldos por empleado. El sistema ya incluye un frontend React responsive, autenticación con Supabase, base PostgreSQL en español y una API NestJS mínima para importaciones privilegiadas.

## Arquitectura

```mermaid
flowchart LR
  A["Administrador · navegador"] -->|"login y CRUD con JWT"| B["Supabase Auth + Data API"]
  B --> C["PostgreSQL · esquema vacaciones + RLS"]
  A -->|"CSV + JWT"| D["NestJS · local o Render"]
  D -->|"clave secreta, después de verificar rol"| C
```

- `frontend/`: React 19 + Next.js 16, panel, calendario, filtros, formularios, modo claro/oscuro y datos demostrativos cuando no hay variables de Supabase.
- `api/`: NestJS. Atiende `/salud`, documentación Swagger, importación CSV administrativa y gestión de accesos/cuenta.
- `database/001_esquema_inicial.sql`: esquema completo, datos base, vistas, RPC, índices y políticas RLS.
- `database/diagrama_vacaciones.dbml`: modelo para pegar en dbdiagram.io.

## Arranque local

Requiere Node.js 22 o posterior.

Frontend:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Abre `http://localhost:3000`.

API NestJS, en otra terminal:

```powershell
cd api
Copy-Item .env.example .env
npm ci
npm run start:dev
```

La API queda en `http://localhost:3001`, su estado en `http://localhost:3001/salud` y Swagger en `http://localhost:3001/documentacion`.

La configuración completa de Supabase, creación del administrador y despliegue está en [docs/CONFIGURACION_SUPABASE.md](docs/CONFIGURACION_SUPABASE.md).

## Validación

```powershell
cd frontend
npm run lint
npm test

cd ..\api
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## Memoria y especificaciones

- [Contexto breve y mapa de archivos](docs/CONTEXTO_PROYECTO.md).
- [Historial de cambios y decisiones](HISTORIAL.md).
- [Uso de memoria, ahorro de contexto y OpenSpec](docs/MEMORIA_Y_ESPECIFICACIONES.md).
- [Guía para que Claude reproduzca la instalación en otro proyecto](docs/GUIA_INSTALACION_IA_PARA_CLAUDE.md).
- [Instrucciones para agentes](AGENTS.md).

OpenSpec se instala en la raíz con `npm ci` (herramientas de desarrollo). Validar las especificaciones con `npm run spec:check`; ver capacidades con `npm run spec:list`.

CodeGraph también se instala con ese `npm ci`. Consultar el estado con `npm run graph:status` y buscar código con `npm run graph -- explore "consulta" --max-files 3`. La conexión de Codex está en `.codex/config.toml`; el índice local y las exclusiones se explican en la guía de memoria.

