#!/bin/bash
set -e

echo "🚀 Démarrage du déploiement de RevTap (NFC Review Tracker)..."

# 1. Mise à jour du code (si tu utilises Git)
echo "📥 Récupération des dernières modifications..."
git pull origin main || echo "Pas de dépôt Git trouvé ou à jour, on continue."

# 2. Vérification du fichier .env
if [ ! -f .env.prod ]; then
    echo "⚠️  Le fichier .env.prod est manquant à la racine du projet."
    echo "➡️  Création d'un fichier .env.prod par défaut..."
    cp deploy/.env.prod .env.prod
    echo "❌ STOP : Veuillez modifier le fichier .env.prod avec vos vrais mots de passe (nano .env.prod), puis relancez ./deploy.sh"
    exit 1
fi

# 3. Lancement de Docker Compose
echo "🐳 Construction et démarrage des conteneurs en production..."
docker compose -f deploy/docker-compose.prod.yml up --build -d

echo "✅ Déploiement Docker terminé avec succès !"
echo "🌐 L'application tourne sur le port local 3050."
echo ""
echo "Si c'est la TOUTE PREMIÈRE installation sur ce VPS, configurez Nginx avec ces commandes :"
echo "  sudo cp deploy/nginx.conf /etc/nginx/sites-available/revtap.pro"
echo "  sudo ln -s /etc/nginx/sites-available/revtap.pro /etc/nginx/sites-enabled/ 2>/dev/null || true"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo "  sudo certbot --nginx -d revtap.pro -d www.revtap.pro"
