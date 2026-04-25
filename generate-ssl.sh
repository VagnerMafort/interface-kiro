#!/bin/bash
# Gera certificados SSL auto-assinados para o Kiro Mobile Bridge
set -e

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
    echo "Certificados já existem em $CERT_DIR/"
    echo "Delete-os manualmente se quiser regenerar."
    exit 0
fi

# Detecta IP do servidor
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$SERVER_IP" ] && SERVER_IP="127.0.0.1"

echo "Gerando certificado SSL auto-assinado..."
echo "  IP detectado: $SERVER_IP"

openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 365 \
    -subj "/CN=Kiro Mobile Bridge" \
    -addext "subjectAltName=IP:$SERVER_IP,IP:127.0.0.1,DNS:localhost"

chmod 600 "$CERT_DIR/key.pem"

echo ""
echo "Certificados gerados em $CERT_DIR/"
echo "  cert.pem  (certificado)"
echo "  key.pem   (chave privada)"
echo ""
echo "Adicione ao .env:"
echo "  SSL_CERT=certs/cert.pem"
echo "  SSL_KEY=certs/key.pem"
echo ""
echo "Acesse: https://$SERVER_IP:9090"
echo "(O navegador vai avisar sobre certificado auto-assinado - é normal)"
