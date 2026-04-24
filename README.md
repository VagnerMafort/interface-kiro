# 📱 Kiro Mobile Bridge

Interface web responsiva que permite acessar o **Kiro IDE** pelo celular, criando uma ponte entre o desktop e o mobile.

## Como funciona

```
┌──────────┐     WebSocket      ┌──────────────┐      VNC       ┌──────────┐
│  Celular  │ ◄──────────────► │  Kiro Bridge  │ ◄────────────► │  Desktop │
│ (Browser) │   Interface Web   │  (Flask App)  │   websockify   │  (Kiro)  │
└──────────┘                    └──────────────┘                 └──────────┘
```

- **Para o Kiro**: tudo parece um desktop normal (conexão VNC padrão)
- **Para você**: interface touch-friendly otimizada para celular

## Funcionalidades

- 🖥️ Visualização remota do desktop via noVNC
- ⌨️ Teclado virtual otimizado para código
- 🎯 Barra de atalhos rápidos (Ctrl+S, Ctrl+Z, Command Palette, etc.)
- 🖱️ Dois modos de toque: Touchpad e Direto
- 📐 Zoom e escala ajustáveis
- 🎨 Controle de qualidade de imagem (Auto/Alta/Média/Baixa)
- 📱 PWA - instale como app no celular
- 🌗 Interface dark theme (Catppuccin Mocha)

## Instalação Rápida

```bash
git clone https://github.com/VagnerMafort/interface-kiro.git
cd interface-kiro
chmod +x install.sh
./install.sh
```

## Uso

### 1. Inicie um servidor VNC no desktop

**Linux:**
```bash
x11vnc -display :0 -rfbport 5900 -passwd kiro123 -forever -shared
```

**Windows:**
- Instale [TightVNC](https://www.tightvnc.com/download.php) ou [TigerVNC](https://tigervnc.org/)
- Inicie o servidor VNC na porta 5900

**macOS:**
- Preferências do Sistema > Compartilhamento > Compartilhamento de Tela

### 2. Inicie a bridge

```bash
# Ative o venv
source venv/bin/activate  # Linux/Mac
# ou
venv\Scripts\activate     # Windows

# Inicie
python app.py
```

### 3. Acesse pelo celular

Abra no navegador do celular:
```
http://SEU_IP_LOCAL:8080
```

> Dica: descubra seu IP com `ip addr` (Linux) ou `ipconfig` (Windows)

## Configuração

Edite o arquivo `.env`:

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `VNC_HOST` | localhost | IP do servidor VNC |
| `VNC_PORT` | 5900 | Porta do servidor VNC |
| `VNC_PASSWORD` | kiro123 | Senha do VNC |
| `WEBSOCKIFY_PORT` | 6081 | Porta do websockify |
| `APP_PORT` | 8080 | Porta da interface web |

## Controles Mobile

| Gesto | Ação |
|-------|------|
| Toque | Clique esquerdo |
| Toque longo | Clique direito |
| Dois dedos | Scroll |
| Pinch | Zoom |
| Arrastar | Mover mouse (modo touchpad) |

## Instalar como PWA

1. Acesse `http://SEU_IP:8080` no Chrome do celular
2. Toque em "⋮" > "Adicionar à tela inicial"
3. Agora funciona como um app nativo!

## Setup no VPS (Recomendado)

Rode o Kiro direto num VPS e acesse de qualquer lugar pelo celular:

```bash
# No VPS (Ubuntu/Debian)
git clone https://github.com/VagnerMafort/interface-kiro.git
cd interface-kiro
chmod +x setup-vps.sh
./setup-vps.sh
```

Isso instala automaticamente:
- Desktop virtual XFCE
- TigerVNC Server
- Kiro Bridge (interface mobile)
- Serviços systemd (inicia no boot)

Depois é só acessar `http://IP_DO_VPS:8080` pelo celular.

## Requisitos

**VPS:**
- Ubuntu 22.04+ ou Debian 12+
- Mínimo 2GB RAM, 2 vCPU
- Python 3.8+

**Local:**
- Python 3.8+
- Servidor VNC rodando no desktop
- Celular e desktop na mesma rede (ou VPN/Tailscale)

## Licença

MIT
