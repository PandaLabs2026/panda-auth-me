# PandaAuth.Me 镜像（账户中心 BFF + React SPA，生产绑定 127.0.0.1:9007）
# 工作区根目录为构建上下文，包含同级 panda-auth-share ProjectReference。
#   docker build -f panda-auth-me/Dockerfile -t panda-auth-me:latest .

# ================= 前端构建 =================
FROM node:24-bookworm-slim AS frontend
WORKDIR /src/panda-auth-me/frontend
COPY panda-auth-me/frontend/package.json panda-auth-me/frontend/package-lock.json* ./
RUN npm install
COPY panda-auth-me/frontend/ .
RUN npm run build

# ================= 后端构建 =================
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY panda-auth-me/PandaAuth.Me.slnx panda-auth-me/global.json panda-auth-me/Directory.Build.props panda-auth-me/Directory.Packages.props ./
COPY panda-auth-me/src/ panda-auth-me/src/
COPY panda-auth-share/ panda-auth-share/
RUN dotnet publish panda-auth-me/src/PandaAuth.Me -c Release -o /app --nologo

# ================= 运行阶段 =================
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=build /app .
COPY --from=frontend /src/panda-auth-me/src/PandaAuth.Me/wwwroot/me ./wwwroot/me/

ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://127.0.0.1:9007

EXPOSE 9007

ENTRYPOINT ["dotnet", "PandaAuth.Me.dll"]
