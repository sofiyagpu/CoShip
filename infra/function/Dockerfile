FROM node:24-bookworm-slim
WORKDIR /runtime
COPY infra/function/runtime.mjs /runtime/runtime.mjs
USER 65532:65532
ENTRYPOINT ["node", "--max-old-space-size=128", "/runtime/runtime.mjs"]
