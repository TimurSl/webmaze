{
  description = "Webmaze: co-op first-person webcore horror in the browser";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in
    {
      packages = forAll (pkgs: {
        default = pkgs.buildNpmPackage {
          pname = "webmaze";
          version = "0.1.0";
          src = self;
          nodejs = pkgs.nodejs_22;
          # Run `nix build` once with lib.fakeHash and paste the hash it prints.
          npmDepsHash = "sha256-1VmZYH7mw01GUeeYn5DFWVY8bM6Ic8IXBStEx1VJDcw=";
          npmBuildScript = "build";
          dontNpmInstall = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out/share/webmaze $out/bin
            cp -r packages/client/dist $out/share/webmaze/client
            cp packages/server/dist/server.mjs $out/share/webmaze/server.mjs
            cat > $out/bin/webmaze-server <<EOF
            #!${pkgs.runtimeShell}
            exec ${pkgs.nodejs_22}/bin/node --no-warnings $out/share/webmaze/server.mjs "\$@"
            EOF
            chmod +x $out/bin/webmaze-server
            runHook postInstall
          '';
        };
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell { packages = [ pkgs.nodejs_22 ]; };
      });

      nixosModules.default = { config, lib, pkgs, ... }:
        let cfg = config.services.webmaze; in
        {
          options.services.webmaze = {
            enable = lib.mkEnableOption "Webmaze game server";
            domain = lib.mkOption { type = lib.types.str; example = "maze.example.com"; description = "Public domain, served over automatic HTTPS by nginx (certificates from Let's Encrypt)."; };
            port = lib.mkOption { type = lib.types.port; default = 2567; description = "Local port of the game server (bound to 127.0.0.1)."; };
            maxPlayersPerRoom = lib.mkOption { type = lib.types.ints.between 1 6 ; default = 6; };
            package = lib.mkOption { type = lib.types.package; default = self.packages.${pkgs.system}.default; };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.webmaze = {
              description = "Webmaze game server";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];
              environment = {
                PORT = toString cfg.port;
                HOST = "127.0.0.1";
                STATE_DIRECTORY = "/var/lib/webmaze";
                WEBMAZE_MAX_PLAYERS = toString cfg.maxPlayersPerRoom;
              };
              serviceConfig = {
                ExecStart = "${cfg.package}/bin/webmaze-server";
                DynamicUser = true;
                StateDirectory = "webmaze";
                Restart = "on-failure";
                NoNewPrivileges = true;
                ProtectSystem = "strict";
                ProtectHome = true;
                PrivateTmp = true;
                MemoryDenyWriteExecute = false; # V8 needs JIT
              };
            };

            services.nginx = {
              enable = true;
              recommendedProxySettings = true;
              recommendedOptimisation = true;
              recommendedGzipSettings = true;
              virtualHosts.${cfg.domain} = {
                forceSSL = true;
                enableACME = true;
                root = "${cfg.package}/share/webmaze/client";
                locations."/" = {
                  tryFiles = "$uri /index.html";
                };
                # Trailing slash on proxy_pass strips the /api prefix, like Caddy's handle_path.
                # Upgrade headers are needed for the game server's WebSocket connections.
                locations."/api/" = {
                  proxyPass = "http://127.0.0.1:${toString cfg.port}/";
                  proxyWebsockets = true;
                };
              };
            };

            security.acme = {
              acceptTerms = true;
            };

            networking.firewall.allowedTCPPorts = [ 80 443 ];
          };
        };
    };
}
