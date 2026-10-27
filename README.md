# tvarkau-app

Savarankiškai talpinama web programa, kuri iš nuotraukų paruošia ir pateikia [tvarkaumiesta.lt](https://tvarkaumiesta.lt) (Vilnius) pranešimą apie transporto priemonės stovėjimo pažeidimą.

- Įkeliate nuotraukas (iPhone HEIC ar JPG). Programa iš EXIF paima laiką ir GPS, nustato adresą (OpenStreetMap Nominatim) ir sugrupuoja nuotraukas į atvejus.
- Pasirinktinai [Claude](https://www.anthropic.com/claude) atpažįsta valstybinį numerį ir pažeidimą (KET 150.4 / 150.5 / 150.6 / 150.10 / 150.16). Be API rakto veikia rankinis režimas.
- Jei pažeidimas senesnis nei 30 dienų, programa įspėja, kad VMSA tokio pranešimo nenagrinės, ir reikalauja patvirtinimo.
- Pranešimas pateikiamas tuo pačiu API, kurį naudoja tvarkaumiesta.lt svetainė, prisijungus per Vilnius Login.
- Pateikti pranešimai išsaugomi `/data`: žurnalas `zurnalas.csv` ir kiekvieno atvejo aplankas su nuotraukomis.

## Paleidimas

```bash
docker build -t mobertas/tvarkau:latest .
./scripts/set-secrets.sh        # nebūtina: Vilnius Login, ANTHROPIC_API_KEY, pareiškėjo duomenys
docker compose up -d            # http://<host>:5580
```

Portainer šablonas: [`deploy/portainer-stack.example.yaml`](deploy/portainer-stack.example.yaml).

## Slapti duomenys

Į image ir repo jokie slapti duomenys nepatenka. Jie skaitomi vykdymo metu iš Docker secrets (`/run/secrets/…`), o failai laikomi hoste, `./secrets/` aplanke (`chmod 600`, įrašytas į `.gitignore` ir `.dockerignore`).

| Secret | Paskirtis | Jei tuščias |
|---|---|---|
| `vilnius_username`, `vilnius_password` | automatinis prisijungimas | prisijungiate pačioje programoje |
| `anthropic_api_key` | numerio ir pažeidimo atpažinimas | rankinis režimas |
| `applicant.json` | pareiškėjo duomenys, jei jų trūksta Vilnius Login profilyje | naudojamas tik profilis |

Programoje įvestas slaptažodis naudojamas tik prisijungimui ir niekur neišsaugomas. Pažymėjus „Prisiminti sesiją“, `/data/session.json` išsaugomas tik sesijos raktas.

## Saugumas

Programa neturi savo autentifikacijos: kas ją pasiekia, tas gali teikti pranešimus jūsų vardu. Neatidarykite jos į internetą. Laikykite ją LAN'e arba už VPN (pvz. Tailscale) ir pririškite prievadą prie konkretaus IP (`BIND_IP`).

## Pastabos

- `CLIENT_KEY` faile `src/vilnius.mjs` yra viešas tvarkaumiesta.lt svetainės kliento identifikatorius iš jos JavaScript kodo, o ne paslaptis.
- Svetainės viešas nuasmenintojas „KET 150“ palaiko valstybiniu numeriu, todėl aprašyme rašoma „Kelių eismo taisyklių 150.5 p.“.
- Tai neoficialus įrankis. Jis nesusijęs su Vilniaus miesto savivaldybe.
