#!/bin/bash
# Gera certificados SSL auto-assinados para o Kiro Mobile Bridge
set -e

DOMAIN="kiro.grupomafort.com"
CERT_DIR="certs"
mkdir -p "$CERT_DIR"

if [ -f "$CERT_DIR/cert.pem" ] && [ -f "$CERT_DIR/key.pem" ]; then
    echo "Certificados já existem em $CERT_DIR/"
    echo "Delete-os manualmente se quiser regenerar."
    exit 0
fi

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$SERVER_IP" ] && SERVER_IP="127.0.0.1"

echo "Gerando certificado SSL auto-assinado..."
echo "  Domínio: $DOMAIN"
echo "  IP detectado: $SERVER_IP"

openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 365 \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:*.grupomafort.com,IP:$SERVER_IP,IP:127.0.0.1,DNS:localhost"

chmod 600 "$CERT_DIR/key.pem"

echo ""
echo "Certificados gerados em $CERT_DIR/"
echo "  cert.pem  (certificado)"
echo "  key.pem   (chave privada)"
echo ""
echo "Acesse: https://$DOMAIN:9090"
