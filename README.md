# bote. (versión para desplegar gratis)

Divide los gastos del viaje sin descargar apps y sin crear cuentas. Cada grupo tiene un código de 6 letras y un enlace de invitación; cualquiera con el enlace puede entrar, añadir gastos y ver las cuentas al día.

Esta versión usa **Postgres** en lugar de SQLite, para poder desplegarla gratis en plataformas cuyo disco es efímero (Render, etc.) sin perder los datos.

## Desplegar gratis: Render + Neon (recomendado)

Coste total: **0 €**. Ni Render ni Neon piden tarjeta para sus planes gratuitos.

### 1. Crea la base de datos en Neon (2 min)

1. Entra en [neon.tech](https://neon.tech) y regístrate (con GitHub o Google).
2. Crea un proyecto (elige la región de Europa, p. ej. Frankfurt).
3. Copia la **cadena de conexión** ("Connection string"), algo como:
   `postgresql://usuario:contraseña@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`

### 2. Sube este proyecto a GitHub

Crea un repositorio y sube esta carpeta (el `.gitignore` ya excluye `node_modules`).

### 3. Despliega en Render (3 min)

1. Entra en [render.com](https://render.com) y regístrate.
2. **New +** → **Web Service** → conecta tu repositorio de GitHub.
3. Configuración:
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. En **Environment Variables**, añade:
   - `DATABASE_URL` = la cadena de conexión de Neon del paso 1.
5. Pulsa **Deploy**. En un par de minutos tendrás tu URL: `https://bote-xxxx.onrender.com`

Las tablas se crean solas la primera vez que arranca el servidor.

### Cosas a saber del plan gratuito de Render

- **Se duerme tras ~15 min sin visitas** y la primera petición después tarda ~30-50 s en despertar. Para un grupo de amigos es asumible; si os molesta, un monitor gratuito tipo UptimeRobot haciendo ping a `/salud` cada 10 min lo mantiene despierto.
- Por eso usamos Neon y no el Postgres de Render: el gratuito de Render caduca a los 90 días; el de Neon es permanente.

## Alternativas

- **Vercel / Netlify**: son gratis pero *serverless*; este servidor Express no funciona ahí tal cual, habría que reescribir la API como funciones. Si prefieres ese camino, pídemelo y te preparo esa variante.
- **VPS propio u Oracle Cloud Free Tier**: control total y sin siestas, pero más trabajo de administración (proxy, HTTPS, actualizaciones).

## Ejecutar en local

Necesitas Node 18+ y un Postgres (local o el propio Neon):

```bash
npm install
DATABASE_URL="postgresql://..." npm start
```

Abre `http://localhost:3000`. Para probar el flujo completo: crea un grupo en una pestaña normal y únete con el enlace `/g/CODIGO` desde una ventana de incógnito.

## Estructura

```
bote/
├── server.js          # API Express + Postgres (pg)
├── render.yaml        # blueprint opcional para Render
├── package.json
└── public/
    ├── index.html
    ├── app.js         # frontend vanilla JS, sin build
    └── styles.css
```

## API

| Método | Ruta                              | Descripción                                  |
|--------|-----------------------------------|----------------------------------------------|
| POST   | `/api/grupos`                     | Crear grupo `{nombre, miNombre}`             |
| GET    | `/api/grupos/:codigo`             | Leer grupo completo                          |
| POST   | `/api/grupos/:codigo/miembros`    | Unirse `{nombre}` (recupera sitio por nombre)|
| POST   | `/api/grupos/:codigo/gastos`      | Añadir gasto                                 |
| DELETE | `/api/grupos/:codigo/gastos/:id`  | Borrar gasto                                 |
| GET    | `/salud`                          | Ping para monitores de actividad             |

## Cosas a saber

- **Sin cuentas = el código es la llave.** Cualquiera con el código o el enlace ve y edita el grupo. No metáis datos sensibles.
- La identidad de cada persona se guarda en el `localStorage` de su navegador. Si alguien cambia de móvil, entra de nuevo con el mismo código y nombre y recupera su sitio.
- El reparto es a partes iguales entre los participantes marcados en cada gasto.
