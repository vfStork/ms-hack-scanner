# Deployment – Push to Azure Container Registry

Target registry: `vfhackteam4acr.azurecr.io`

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- Docker installed and running
- Logged in to Azure (`az login`)

---

## Steps

### 1. Log in to the ACR

```bash
az acr login --name vfhackteam4acr
```

### 2. Build the Docker image

```bash
docker build -t vfhackteam4acr.azurecr.io/ms-hack-scanner:latest .
```

### 3. Push the image to ACR

```bash
docker push vfhackteam4acr.azurecr.io/ms-hack-scanner:latest
```

---

## One-liner (build + push via ACR Tasks, no local Docker required)

```bash
az acr build \
  --registry vfhackteam4acr \
  --image ms-hack-scanner:latest \
  .
```

---

## Verify the image was pushed

```bash
az acr repository show-tags \
  --name vfhackteam4acr \
  --repository ms-hack-scanner \
  --output table
```
