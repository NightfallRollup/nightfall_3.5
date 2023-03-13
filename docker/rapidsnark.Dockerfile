FROM ubuntu:20.04 as rapidsnark

RUN apt-get update -y
RUN apt-get install -y netcat curl
RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs gcc g++ make
RUN apt install -y build-essential
RUN apt-get install -y libgmp-dev
RUN apt-get install -y libsodium-dev
RUN apt-get install -y nasm
RUN apt-get install -y git
RUN apt-get update -y \
  && apt-get -y install build-essential \
  && apt-get install -y wget \
  && rm -rf /var/lib/apt/lists/* \
  && wget https://github.com/Kitware/CMake/releases/download/v3.24.1/cmake-3.24.1-Linux-x86_64.sh \
      -q -O /tmp/cmake-install.sh \
      && chmod u+x /tmp/cmake-install.sh \
      && mkdir /opt/cmake-3.24.1 \
      && /tmp/cmake-install.sh --skip-license --prefix=/opt/cmake-3.24.1 \
      && rm /tmp/cmake-install.sh \
      && ln -s /opt/cmake-3.24.1/bin/* /usr/local/bin
ENV DEBIAN_FRONTEND noninteractive
RUN apt-get update -y
RUN apt-get upgrade -y
RUN apt-get install -y software-properties-common
RUN add-apt-repository -y ppa:pistache+team/unstable
RUN apt-get update -y
RUN apt-get upgrade -y
RUN apt-get install -y libpistache-dev

WORKDIR /app

# Rapidsnark
RUN git clone https://github.com/iden3/rapidsnark.git
WORKDIR /app/rapidsnark
RUN git fetch --all && git checkout main && git pull && git checkout 6b1e8316ce9000906b7e4c7d2c3e2f3885ed9153

RUN npm install
RUN git submodule init
RUN git submodule update
RUN npx task createFieldSources
RUN npx task buildPistache
RUN npx task buildProverServer
