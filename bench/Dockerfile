# Runtime image: prebuilt dist/ and production node_modules only.
FROM node:24-bookworm-slim
ARG VARIANT=standard
COPY .build/${VARIANT}/ /opt/
WORKDIR /data
ENV HOST=0.0.0.0 PORT=4321 NODE_ENV=production
EXPOSE 4321
CMD ["node", "/opt/app/dist/server/entry.mjs"]
