CLUSTER ?= rehearsal
export KUBE_CONTEXT = kind-$(CLUSTER)
KUBECTL = kubectl --context "$(KUBE_CONTEXT)"
PAYMENT_DEMO = docker compose --env-file /dev/null -p festready-payments -f infra/payment-demo/compose.yaml
SERVICES := partner-mock shop-api load-generator
ALL_APPS := controller dashboard
APPS ?= $(foreach app,$(ALL_APPS),$(if $(wildcard apps/$(app)/Dockerfile),$(app)))
export P

.PHONY: up down images deploy load-start load-stop outage outage-clear redherring monitoring payment-demo-up payment-demo-down payment-demo-smoke

up:
	@clusters=$$(kind get clusters) && { \
		printf '%s\n' "$$clusters" | grep -Fxq "$(CLUSTER)" || \
		kind create cluster --name "$(CLUSTER)" --config infra/kind/cluster.yaml; \
	}
	$(MAKE) images
	$(MAKE) deploy

down:
	kind delete cluster --name "$(CLUSTER)"

images:
	@set -e; for service in $(SERVICES); do \
		docker build --platform linux/arm64 -t "$$service:dev" "services/$$service"; \
	done
	@set -e; for app in $(APPS); do \
		docker build --platform linux/arm64 -t "$$app:dev" "apps/$$app"; \
	done
	kind load docker-image --name "$(CLUSTER)" $(addsuffix :dev,$(SERVICES) $(APPS))

deploy:
	@$(if $(filter-out $(APPS),$(ALL_APPS)),printf 'Apps skipped: %s\n' '$(filter-out $(APPS),$(ALL_APPS))',:)
	$(KUBECTL) apply -f infra/k8s/namespaces.yaml
	@sh infra/k8s/secrets.sh $(if $(filter controller,$(APPS)),true,false)
	@set -e; for component in $(SERVICES) $(APPS); do \
		$(KUBECTL) apply -f "infra/k8s/$$component.yaml"; \
	done
	$(KUBECTL) -n providers rollout status deployment/partner-mock --timeout=120s
	@set -e; for component in shop-api $(APPS); do \
		$(KUBECTL) -n shop rollout status "deployment/$$component" --timeout=120s; \
	done

load-start load-stop:
	$(KUBECTL) -n shop scale deployment/load-generator --replicas=$(if $(filter load-start,$@),1,0)

outage outage-clear:
	@case "$$P" in a|b|c) ;; *) printf 'Set P=a, b or c\n' >&2; exit 2;; esac
	@$(KUBECTL) -n providers exec deployment/partner-mock -- bun -e \
		'const response = await fetch("http://localhost:" + process.env.PORT + "/admin/outage", {method: "POST", headers: {"Content-Type": "application/json", "X-Admin-Secret": process.env.ADMIN_SECRET}, body: JSON.stringify({provider: process.argv[1], status: $(if $(filter outage,$@),500,null)})}); console.log(await response.text()); if (!response.ok) process.exitCode = 1;' \
		-- "$$P"

redherring:
	$(KUBECTL) -n shop rollout restart deployment/shop-api

monitoring:
	@set -ea; . ./.env; set +a; sh infra/monitoring/install.sh "$(KUBE_CONTEXT)"

payment-demo-up:
	$(PAYMENT_DEMO) up --build -d --wait

payment-demo-down:
	$(PAYMENT_DEMO) down

payment-demo-smoke:
	@sh infra/payment-demo/smoke.sh
