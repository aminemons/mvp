FROM node:22-trixie-slim AS gltf
RUN npm install --prefix /opt/gltf gltfpack@1.0.0

FROM python:3.12-slim-trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ffmpeg libgomp1 libstdc++6 unzip \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fLSs --retry 3 \
    https://github.com/cdcseacave/openMVS/releases/download/v2.4.0/OpenMVS_Ubuntu_x64.zip \
    -o /tmp/openmvs.zip \
    && echo '7104ae1ddd6ca38fbca9e0e4a70b20af59e21e0b497eb7181c864fbf38ca8d00  /tmp/openmvs.zip' | sha256sum -c - \
    && mkdir -p /opt/openmvs \
    && unzip -q /tmp/openmvs.zip InterfaceCOLMAP DensifyPointCloud ReconstructMesh -d /opt/openmvs \
    && chmod 755 /opt/openmvs/* \
    && rm /tmp/openmvs.zip

COPY --from=gltf /usr/local/bin/node /usr/local/bin/node
COPY --from=gltf /opt/gltf /opt/gltf
ENV PATH="/opt/gltf/node_modules/.bin:${PATH}" PYTHONUNBUFFERED=1 OPENBLAS_NUM_THREADS=1
WORKDIR /app
COPY requirements-studio.txt .
RUN pip install --no-cache-dir -r requirements-studio.txt
COPY . .
RUN mkdir /data && chown 10001:10001 /data
USER 10001:10001
ENTRYPOINT ["python","scripts/studio_server.py","--host","0.0.0.0","--openmvs","/opt/openmvs","--data","/data"]
