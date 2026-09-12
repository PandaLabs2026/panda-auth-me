# PandaAuth.Me 镜像（账户中心 BFF + React SPA，生产绑定 127.0.0.1:9007）
# 自包含构建（本仓即上下文，前端在容器内 node:24 构建）：
#   docker build -t panda-auth-me:latest panda-auth-me/

# ================= 前端构建 =================
FROM node:24-bookworm-slim AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# ================= 后端构建 =================
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY PandaAuth.Me.slnx global.json Directory.Build.props Directory.Packages.props ./
COPY src/ src/
RUN dotnet publish src/PandaAuth.Me -c Release -o /app --nologo

# ================= 运行阶段 =================
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

COPY --from=build /app .
COPY --from=frontend /src/PandaAuth.Me/wwwroot/me ./wwwroot/me/

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://127.0.0.1:9007

EXPOSE 9007

ENTRYPOINT ["dotnet", "PandaAuth.Me.dll"]
