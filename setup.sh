#!/bin/bash
# NimbleCo Interactive Setup Script
# Works both interactively and headlessly (with pre-configured .env)
#
# Supported platforms:
#   - macOS (Darwin)
#   - Linux (Debian/Ubuntu, RHEL/CentOS/Fedora, Arch)
#   - Windows (via WSL)
#
# Usage:
#   ./setup.sh                # Interactive setup
#   ./setup.sh --quick        # Use last session config, skip confirmations
#   ./setup.sh -q             # Same as --quick

set -e

# ============================================================================
# Platform Detection
# ============================================================================

# Detect operating system
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macos"
    PLATFORM_NAME="macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "linux" ]]; then
    PLATFORM="linux"
    PLATFORM_NAME="Linux"

    # Detect Linux distribution
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        LINUX_DISTRO=$ID
        LINUX_VERSION=$VERSION_ID
    elif [ -f /etc/redhat-release ]; then
        LINUX_DISTRO="rhel"
    elif [ -f /etc/debian_version ]; then
        LINUX_DISTRO="debian"
    else
        LINUX_DISTRO="unknown"
    fi
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "$WSL_DISTRO_NAME" ]]; then
    PLATFORM="windows"
    PLATFORM_NAME="Windows (WSL)"
else
    echo "❌ Unsupported operating system: $OSTYPE"
    echo "   Supported platforms: macOS, Linux, Windows (via WSL)"
    exit 1
fi

# ============================================================================
# Package Manager Detection and Helpers
# ============================================================================

# Detect and set up package manager
case $PLATFORM in
    macos)
        PKG_MANAGER="brew"
        PKG_INSTALL_CMD="brew install"
        PKG_CASK_CMD="brew install --cask"
        ;;
    linux)
        case $LINUX_DISTRO in
            ubuntu|debian)
                PKG_MANAGER="apt"
                PKG_INSTALL_CMD="sudo apt-get install -y"
                ;;
            fedora|rhel|centos)
                PKG_MANAGER="dnf"
                PKG_INSTALL_CMD="sudo dnf install -y"
                ;;
            arch|manjaro)
                PKG_MANAGER="pacman"
                PKG_INSTALL_CMD="sudo pacman -S --noconfirm"
                ;;
            opensuse*)
                PKG_MANAGER="zypper"
                PKG_INSTALL_CMD="sudo zypper install -y"
                ;;
            *)
                PKG_MANAGER="unknown"
                echo -e "${YELLOW}⚠${NC}  Unknown Linux distribution: $LINUX_DISTRO"
                echo "   You may need to install dependencies manually"
                ;;
        esac
        ;;
    windows)
        # WSL uses the Linux distribution's package manager
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            case $ID in
                ubuntu|debian)
                    PKG_MANAGER="apt"
                    PKG_INSTALL_CMD="sudo apt-get install -y"
                    ;;
                fedora|rhel|centos)
                    PKG_MANAGER="dnf"
                    PKG_INSTALL_CMD="sudo dnf install -y"
                    ;;
                *)
                    PKG_MANAGER="unknown"
                    ;;
            esac
        fi
        ;;
esac

# Parse command line arguments
QUICK_MODE=false
for arg in "$@"; do
    case $arg in
        --quick|-q)
            QUICK_MODE=true
            shift
            ;;
    esac
done

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║     🚀 NimbleCo Interactive Setup                   ║"
echo "║                                                           ║"
echo "║     Self-hosted agent orchestration for teams            ║"
echo "║     Platform: ${PLATFORM_NAME}                           ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# ============================================================================
# Helper Functions (must be defined before dependency checks)
# ============================================================================

# Function to prompt for input with default
prompt() {
    local var_name=$1
    local prompt_text=$2
    local default_value=$3
    local is_secret=$4

    if [ -n "${!var_name}" ]; then
        echo -e "${GREEN}✓${NC} $prompt_text: ${BLUE}[already set]${NC}"
        return
    fi

    if [ "$is_secret" = "true" ]; then
        read -s -p "$(echo -e ${YELLOW}?${NC} $prompt_text ${default_value:+[default: $default_value]}: )" input
        echo ""
    else
        read -p "$(echo -e ${YELLOW}?${NC} $prompt_text ${default_value:+[default: $default_value]}: )" input
    fi

    if [ -z "$input" ] && [ -n "$default_value" ]; then
        input=$default_value
    fi

    eval "$var_name='$input'"
}

# Function to confirm yes/no
confirm() {
    local prompt_text=$1
    local default=$2

    # In quick setup mode, use saved answer if available
    if [ "$QUICK_SETUP" = "true" ]; then
        local var_name="SAVED_$(echo "$prompt_text" | sed 's/[^a-zA-Z0-9]/_/g' | tr '[:lower:]' '[:upper:]')"
        if [ -n "${!var_name}" ]; then
            [[ "${!var_name}" =~ ^[Yy] ]] && return 0 || return 1
        fi
    fi

    if [ "$default" = "y" ]; then
        read -p "$(echo -e ${YELLOW}?${NC} $prompt_text [Y/n]: )" response
        response=${response:-y}
    else
        read -p "$(echo -e ${YELLOW}?${NC} $prompt_text [y/N]: )" response
        response=${response:-n}
    fi

    # Save the answer for next time
    local var_name="SAVED_$(echo "$prompt_text" | sed 's/[^a-zA-Z0-9]/_/g' | tr '[:lower:]' '[:upper:]')"
    eval "$var_name='$response'"

    [[ "$response" =~ ^[Yy] ]]
}

# ============================================================================
# Dependency Checks
# ============================================================================

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Checking Dependencies${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

MISSING_DEPS=false

# Check for package manager
if [ "$PLATFORM" = "macos" ]; then
    # Check for Homebrew on macOS
    if ! command -v brew &> /dev/null; then
        echo -e "${YELLOW}ℹ${NC}  Homebrew not found (optional, but makes installation easier)"
        if confirm "Install Homebrew now?" "y"; then
            echo -e "${BLUE}⏳${NC} Installing Homebrew..."
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

            # Source Homebrew for current session (Apple Silicon)
            if [ -f /opt/homebrew/bin/brew ]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            fi

            echo -e "${GREEN}✓${NC} Homebrew installed"
        else
            echo -e "${YELLOW}⚠${NC}  Skipping Homebrew - you'll need to install dependencies manually"
        fi
    else
        echo -e "${GREEN}✓${NC} Homebrew found: $(brew --version | head -n1)"
    fi
elif [ "$PLATFORM" = "linux" ]; then
    # Update package cache on Linux
    case $PKG_MANAGER in
        apt)
            echo -e "${BLUE}⏳${NC} Updating apt package cache..."
            sudo apt-get update > /dev/null 2>&1
            echo -e "${GREEN}✓${NC} Package manager: apt"
            ;;
        dnf)
            echo -e "${GREEN}✓${NC} Package manager: dnf"
            ;;
        pacman)
            echo -e "${GREEN}✓${NC} Package manager: pacman"
            ;;
        zypper)
            echo -e "${GREEN}✓${NC} Package manager: zypper"
            ;;
        *)
            echo -e "${YELLOW}⚠${NC}  Unknown package manager"
            ;;
    esac
fi

echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗${NC} Node.js not found (REQUIRED)"
    echo -e "   Node.js is required to run NimbleCo"

    CAN_INSTALL=false
    case $PLATFORM in
        macos)
            if command -v brew &> /dev/null; then
                CAN_INSTALL=true
                if confirm "Install Node.js via Homebrew?" "y"; then
                    echo -e "${BLUE}⏳${NC} Installing Node.js..."
                    brew install node
                    echo -e "${GREEN}✓${NC} Node.js installed"
                fi
            fi
            ;;
        linux|windows)
            if [ "$PKG_MANAGER" != "unknown" ]; then
                CAN_INSTALL=true
                if confirm "Install Node.js via $PKG_MANAGER?" "y"; then
                    echo -e "${BLUE}⏳${NC} Installing Node.js..."
                    case $PKG_MANAGER in
                        apt)
                            # Use NodeSource for latest version
                            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                            $PKG_INSTALL_CMD nodejs
                            ;;
                        dnf)
                            $PKG_INSTALL_CMD nodejs
                            ;;
                        pacman)
                            $PKG_INSTALL_CMD nodejs npm
                            ;;
                        zypper)
                            $PKG_INSTALL_CMD nodejs
                            ;;
                    esac
                    echo -e "${GREEN}✓${NC} Node.js installed"
                fi
            fi
            ;;
    esac

    if [ "$CAN_INSTALL" = "false" ]; then
        MISSING_DEPS=true
        echo -e "${RED}✗${NC} Please install Node.js manually: https://nodejs.org/"
    fi
else
    NODE_VERSION=$(node --version)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')

    if [ "$NODE_MAJOR" -lt 18 ]; then
        echo -e "${YELLOW}⚠${NC}  Node.js $NODE_VERSION found (version 18+ recommended)"

        if [ "$PLATFORM" = "macos" ] && command -v brew &> /dev/null; then
            if confirm "Upgrade Node.js via Homebrew?" "y"; then
                echo -e "${BLUE}⏳${NC} Upgrading Node.js..."
                brew upgrade node
                echo -e "${GREEN}✓${NC} Node.js upgraded"
            fi
        elif [ "$PKG_MANAGER" != "unknown" ]; then
            if confirm "Upgrade Node.js via $PKG_MANAGER?" "y"; then
                echo -e "${BLUE}⏳${NC} Upgrading Node.js..."
                # Platform-specific upgrade commands
                case $PKG_MANAGER in
                    apt)
                        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
                        $PKG_INSTALL_CMD nodejs
                        ;;
                    *)
                        $PKG_INSTALL_CMD nodejs
                        ;;
                esac
                echo -e "${GREEN}✓${NC} Node.js upgraded"
            fi
        fi
    else
        echo -e "${GREEN}✓${NC} Node.js $NODE_VERSION found"
    fi
fi

echo ""

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗${NC} Docker not found (REQUIRED)"
    echo -e "   Docker is required for PostgreSQL and NATS"

    CAN_INSTALL=false
    case $PLATFORM in
        macos)
            if command -v brew &> /dev/null; then
                CAN_INSTALL=true
                if confirm "Install Docker Desktop via Homebrew?" "y"; then
                    echo -e "${BLUE}⏳${NC} Installing Docker Desktop (this may take a few minutes)..."
                    brew install --cask docker
                    echo -e "${GREEN}✓${NC} Docker Desktop installed"
                    echo -e "${YELLOW}ℹ${NC}  Opening Docker Desktop..."
                    open -a Docker

                    echo -e "${BLUE}⏳${NC} Waiting for Docker Desktop to start..."
                    for i in {1..90}; do
                        if docker info &> /dev/null 2>&1; then
                            echo -e "${GREEN}✓${NC} Docker Desktop is ready"
                            break
                        fi
                        sleep 2
                    done

                    if ! docker info &> /dev/null 2>&1; then
                        echo -e "${YELLOW}⚠${NC}  Docker Desktop is taking a while to start"
                        read -p "Press Enter once Docker Desktop is ready..."
                    fi
                fi
            fi
            ;;
        linux|windows)
            if [ "$PKG_MANAGER" != "unknown" ]; then
                CAN_INSTALL=true
                if confirm "Install Docker via $PKG_MANAGER?" "y"; then
                    echo -e "${BLUE}⏳${NC} Installing Docker..."
                    case $PKG_MANAGER in
                        apt)
                            # Install Docker Engine on Ubuntu/Debian
                            $PKG_INSTALL_CMD apt-transport-https ca-certificates curl gnupg lsb-release
                            curl -fsSL https://download.docker.com/linux/$(lsb_release -is | tr '[:upper:]' '[:lower:]')/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
                            echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/$(lsb_release -is | tr '[:upper:]' '[:lower:]') $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
                            sudo apt-get update
                            $PKG_INSTALL_CMD docker-ce docker-ce-cli containerd.io docker-compose-plugin
                            sudo systemctl start docker
                            sudo systemctl enable docker
                            sudo usermod -aG docker $USER
                            echo -e "${YELLOW}ℹ${NC}  You may need to log out and back in for Docker permissions to take effect"
                            ;;
                        dnf)
                            $PKG_INSTALL_CMD docker docker-compose
                            sudo systemctl start docker
                            sudo systemctl enable docker
                            sudo usermod -aG docker $USER
                            ;;
                        pacman)
                            $PKG_INSTALL_CMD docker docker-compose
                            sudo systemctl start docker
                            sudo systemctl enable docker
                            sudo usermod -aG docker $USER
                            ;;
                        zypper)
                            $PKG_INSTALL_CMD docker docker-compose
                            sudo systemctl start docker
                            sudo systemctl enable docker
                            sudo usermod -aG docker $USER
                            ;;
                    esac
                    echo -e "${GREEN}✓${NC} Docker installed"
                fi
            fi
            ;;
    esac

    if [ "$CAN_INSTALL" = "false" ]; then
        MISSING_DEPS=true
        if [ "$PLATFORM" = "macos" ]; then
            echo -e "${RED}✗${NC} Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
        else
            echo -e "${RED}✗${NC} Please install Docker: https://docs.docker.com/engine/install/"
        fi
    fi
elif ! docker info &> /dev/null 2>&1; then
    echo -e "${YELLOW}⚠${NC}  Docker installed but not running"

    if [ "$PLATFORM" = "macos" ]; then
        echo -e "${BLUE}⏳${NC} Starting Docker Desktop..."
        open -a Docker

        echo -e "${BLUE}⏳${NC} Waiting for Docker to be ready..."
        for i in {1..60}; do
            if docker info &> /dev/null 2>&1; then
                echo -e "${GREEN}✓${NC} Docker is ready"
                break
            fi
            sleep 1
        done

        if ! docker info &> /dev/null 2>&1; then
            echo -e "${RED}✗${NC} Docker failed to start in time"
            echo -e "   Please start Docker Desktop manually and try again"
            exit 1
        fi
    else
        echo -e "${BLUE}⏳${NC} Starting Docker..."
        sudo systemctl start docker

        sleep 2
        if docker info &> /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Docker is ready"
        else
            echo -e "${RED}✗${NC} Docker failed to start"
            echo -e "   Please check: sudo systemctl status docker"
            exit 1
        fi
    fi
else
    echo -e "${GREEN}✓${NC} Docker is running"
fi

echo ""

# Check for Ollama (optional, for local LLMs)
if ! command -v ollama &> /dev/null; then
    echo -e "${YELLOW}ℹ${NC}  Ollama not found (optional - for local LLM support)"

    case $PLATFORM in
        macos)
            if command -v brew &> /dev/null; then
                if confirm "Install Ollama for local LLM support?" "n"; then
                    echo -e "${BLUE}⏳${NC} Installing Ollama..."
                    brew install ollama
                    brew services start ollama
                    echo -e "${GREEN}✓${NC} Ollama installed and started"
                else
                    echo -e "${YELLOW}ℹ${NC}  Skipping Ollama - install later: brew install ollama"
                fi
            fi
            ;;
        linux|windows)
            if confirm "Install Ollama for local LLM support?" "n"; then
                echo -e "${BLUE}⏳${NC} Installing Ollama..."
                curl -fsSL https://ollama.com/install.sh | sh
                echo -e "${YELLOW}ℹ${NC}  Starting Ollama service..."
                if command -v systemctl &> /dev/null; then
                    sudo systemctl start ollama 2>/dev/null || true
                    sudo systemctl enable ollama 2>/dev/null || true
                fi
                echo -e "${GREEN}✓${NC} Ollama installed"
            else
                echo -e "${YELLOW}ℹ${NC}  Skipping Ollama - install later: https://ollama.com"
            fi
            ;;
    esac
else
    echo -e "${GREEN}✓${NC} Ollama found"

    # Check if Ollama service is running
    if ! pgrep -x "ollama" > /dev/null; then
        echo -e "${BLUE}⏳${NC} Starting Ollama service..."
        if [ "$PLATFORM" = "macos" ] && command -v brew &> /dev/null; then
            brew services start ollama
        elif command -v systemctl &> /dev/null; then
            sudo systemctl start ollama 2>/dev/null || true
        fi
        sleep 2
        echo -e "${GREEN}✓${NC} Ollama service started"
    fi
fi

echo ""

# Exit if required dependencies are missing
if [ "$MISSING_DEPS" = true ]; then
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  Missing Required Dependencies${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${RED}Please install the missing dependencies above and run setup again.${NC}"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} All dependencies satisfied!"
echo ""

# ============================================================================
# Session Management
# ============================================================================

# Check for previous session config
QUICK_SETUP=false
if [ -f .setup-last-session ]; then
    echo -e "${GREEN}✓${NC} Found configuration from previous session"
    echo ""

    # If --quick flag was passed, skip the confirmation
    if [ "$QUICK_MODE" = "true" ]; then
        source .setup-last-session
        QUICK_SETUP=true
        echo -e "${GREEN}✓${NC} Quick mode: loaded previous session configuration"
        echo ""

        if [ -f .env ]; then
            source .env
        fi
    elif confirm "Keep everything the same as last session?" "y"; then
        source .setup-last-session
        QUICK_SETUP=true
        echo -e "${GREEN}✓${NC} Loaded previous session configuration"
        echo -e "${BLUE}ℹ${NC}  Skipping interactive setup, using saved answers..."
        echo ""

        # Also load the .env if it exists
        if [ -f .env ]; then
            source .env
        fi
    else
        echo -e "${BLUE}ℹ${NC}  Starting fresh setup..."
        echo ""
    fi
elif [ "$QUICK_MODE" = "true" ]; then
    echo -e "${YELLOW}⚠${NC}  Quick mode requested but no previous session found"
    echo -e "${BLUE}ℹ${NC}  Running interactive setup..."
    echo ""
fi

# Check if .env exists (skip this prompt if in quick setup mode)
if [ "$QUICK_SETUP" = "false" ]; then
    if [ -f .env ]; then
        echo -e "${YELLOW}ℹ${NC}  Found existing .env file"

        if confirm "Load existing configuration?" "y"; then
            source .env
            echo -e "${GREEN}✓${NC} Loaded existing .env"
        else
            echo -e "${YELLOW}⚠${NC}  Creating new configuration (old .env backed up to .env.backup)"
            cp .env .env.backup
            rm .env
        fi
    else
        echo -e "${BLUE}ℹ${NC}  No .env found, creating new configuration"
    fi
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  LLM Configuration${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "NimbleCo supports multiple LLM providers."
echo "You need AT LEAST ONE. Local (Ollama) is free, cloud provides better quality."
echo ""

# Ollama (local, free)
if confirm "Use Ollama for local LLM? (FREE, recommended)" "y"; then
    OLLAMA_URL=${OLLAMA_URL:-http://localhost:11434}

    echo -e "${BLUE}ℹ${NC}  Checking if Ollama is running..."
    if curl -s "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Ollama is running at $OLLAMA_URL"

        # Check for models
        if curl -s "$OLLAMA_URL/api/tags" | grep -q "qwen3.5:9b"; then
            echo -e "${GREEN}✓${NC} Qwen 3.5 (9B) already installed"
        else
            if confirm "  Install Qwen 3.5 (9B, latest best small model with 256K context)?" "y"; then
                echo -e "${BLUE}⏳${NC} Pulling qwen3.5:9b (this may take 2-3 minutes)..."
                ollama pull qwen3.5:9b
            fi
        fi

        if curl -s "$OLLAMA_URL/api/tags" | grep -q "qwen2.5-coder"; then
            echo -e "${GREEN}✓${NC} Qwen 2.5 Coder (32B) already installed"
        else
            if confirm "  Install Qwen 2.5 Coder (32B, best for code)?" "y"; then
                echo -e "${BLUE}⏳${NC} Pulling qwen2.5-coder:32b (this may take 5-10 minutes)..."
                ollama pull qwen2.5-coder:32b
            fi
        fi

        LLM_MODEL_QUICK=${LLM_MODEL_QUICK:-qwen3.5:9b}
        LLM_MODEL_CODE=${LLM_MODEL_CODE:-qwen2.5-coder:32b}
    else
        echo -e "${YELLOW}⚠${NC}  Ollama not running. Install with:"
        echo "     brew install ollama"
        echo "     ollama serve"
        echo "     ollama pull qwen3.5:9b          # Latest best small model (256K context)"
        echo "     ollama pull qwen2.5-coder:32b   # Best for code"
        echo ""
    fi
fi

echo ""

# Anthropic Claude
if confirm "Use Anthropic Claude? (Paid, best quality)" "n"; then
    prompt ANTHROPIC_API_KEY "Anthropic API key" "" "true"
    ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-claude-sonnet-4-5-20250929}
fi

# Google Vertex AI
if confirm "Use Google Vertex AI? (\$300 free credits)" "n"; then
    prompt VERTEX_AI_PROJECT "GCP Project ID" ""
    prompt VERTEX_AI_LOCATION "GCP Region" "us-central1"
    echo -e "${BLUE}ℹ${NC}  Make sure you've run: gcloud auth application-default login"
fi

# AWS Bedrock
SETUP_BEDROCK=false
if [ -n "$AWS_REGION" ] && [ -n "$BEDROCK_MODEL_ID" ]; then
    echo -e "${GREEN}✓${NC} AWS Bedrock already configured"
    echo -e "     Model: ${BLUE}$BEDROCK_MODEL_ID${NC}"
    echo -e "     Region: ${BLUE}$AWS_REGION${NC}"
    echo "     [u]pdate / [r]emove / [k]eep (default: keep)"
    read -p "     Choice: " BEDROCK_CHOICE
    case "$BEDROCK_CHOICE" in
        u|U|update)
            unset AWS_REGION BEDROCK_MODEL_ID AWS_BEARER_TOKEN_BEDROCK
            SETUP_BEDROCK=true
            ;;
        r|R|remove)
            unset AWS_REGION BEDROCK_MODEL_ID AWS_BEARER_TOKEN_BEDROCK
            echo -e "${YELLOW}ℹ${NC}  Bedrock configuration will be removed"
            ;;
    esac
else
    if confirm "Use AWS Bedrock? (Free tier available)" "n"; then
        SETUP_BEDROCK=true
    fi
fi

if [ "$SETUP_BEDROCK" = "true" ]; then
    prompt AWS_REGION "AWS Region" "us-east-1"
    prompt BEDROCK_MODEL_ID "Bedrock Model ID or ARN" "anthropic.claude-sonnet-4-20250514-v1:0"
    prompt AWS_BEARER_TOKEN_BEDROCK "AWS Bearer Token (optional)" "" "true"
    echo -e "${BLUE}ℹ${NC}  Bedrock uses AWS credentials from: aws configure"
    echo -e "${BLUE}ℹ${NC}  Or provide bearer token for temporary access"
fi

# LLM Routing
prompt LLM_DAILY_COST_LIMIT "Daily LLM cost limit (USD)" "10.00"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Core Infrastructure${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

NATS_URL=${NATS_URL:-nats://localhost:4222}
DATABASE_URL=${DATABASE_URL:-postgresql://agent:password@localhost:5432/nimbleco}

echo -e "${GREEN}✓${NC} NATS: $NATS_URL"
echo -e "${GREEN}✓${NC} PostgreSQL: $DATABASE_URL"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Integration Tools${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Mattermost
SETUP_MATTERMOST=false
MATTERMOST_REMOVED=false
if [ -n "$MATTERMOST_BOT_TOKEN" ]; then
    echo -e "${GREEN}✓${NC} Mattermost already configured"
    echo "     [u]pdate / [r]emove / [k]eep (default: keep)"
    read -p "     Choice: " MM_CHOICE
    case "$MM_CHOICE" in
        u|U|update)
            unset MATTERMOST_BOT_TOKEN MATTERMOST_URL MATTERMOST_CHANNEL
            SETUP_MATTERMOST=true
            ;;
        r|R|remove)
            unset MATTERMOST_BOT_TOKEN MATTERMOST_URL MATTERMOST_CHANNEL
            MATTERMOST_REMOVED=true
            echo -e "${YELLOW}ℹ${NC}  Mattermost configuration will be removed"
            ;;
    esac
else
    if confirm "Set up Mattermost integration?" "n"; then
        SETUP_MATTERMOST=true
    fi
fi

if [ "$SETUP_MATTERMOST" = "true" ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Mattermost Setup${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Mattermost can run locally (testing) or connect to a hosted server (production)."
    echo ""
    echo "Options:"
    echo -e "  1. ${GREEN}Hosted/Production${NC} - Connect to existing Mattermost server (RECOMMENDED)"
    echo "     + Use your team's production server"
    echo "     + No local setup needed"
    echo "     - Requires bot account to be created"
    echo ""
    echo -e "  2. ${GREEN}Local${NC} - Run Mattermost on this machine (http://localhost:8065)"
    echo "     + Full control, local testing"
    echo "     - Only accessible from this device"
    echo "     - Takes ~30s to start"
    echo ""

    USE_LOCAL_MATTERMOST="false"
    if confirm "Use local Mattermost server?" "n"; then
        USE_LOCAL_MATTERMOST="true"
        MATTERMOST_URL="http://localhost:8065"
    else
        USE_LOCAL_MATTERMOST="false"
        echo ""
        read -p "Enter Mattermost server URL (e.g., https://mattermost.example.com): " CUSTOM_MATTERMOST

        # Auto-add https:// if missing
        if [[ ! "$CUSTOM_MATTERMOST" =~ ^https?:// ]]; then
            CUSTOM_MATTERMOST="https://${CUSTOM_MATTERMOST}"
            echo -e "${BLUE}ℹ${NC}  Added https:// → $CUSTOM_MATTERMOST"
        fi
        MATTERMOST_URL="${CUSTOM_MATTERMOST}"
    fi

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Bot Configuration${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "Server: ${GREEN}$MATTERMOST_URL${NC}"
    echo ""

    if [ "$USE_LOCAL_MATTERMOST" = "true" ]; then
        echo "For local Mattermost:"
        echo "  1. Run setup to completion (Mattermost will start automatically)"
        echo "  2. Open $MATTERMOST_URL"
        echo "  3. Create admin account"
        echo "  4. Go to System Console → Integrations → Bot Accounts"
        echo "  5. Create a bot and copy the token"
        echo "  6. Add token to .env: MATTERMOST_BOT_TOKEN=..."
        echo ""
        echo "Leave blank for now to configure later:"
    else
        echo "Steps to create bot account:"
        echo "  1. Log in to $MATTERMOST_URL as admin"
        echo "  2. Go to Integrations → Bot Accounts"
        echo "  3. Create a bot with post:all and post:channels permissions"
        echo "  4. Copy the bot token"
        echo ""
    fi

    prompt MATTERMOST_BOT_TOKEN "Mattermost bot token (optional for now)" "" "true"
    prompt MATTERMOST_CHANNEL "Default channel" "agent-tasks"

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Bot Access Controls (Optional)${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Admin users get special permissions:"
    echo "  • Can use privileged operations"
    echo "  • Bypass rate limiting"
    echo "  • Access sensitive tools"
    echo ""
    echo "Non-admin users have standard access."
    echo ""

    if confirm "Configure admin users?" "n"; then
        echo ""
        echo "Enter Mattermost user IDs (comma-separated)."
        echo "Find user IDs in Mattermost: Profile → Advanced → User ID"
        echo ""
        read -p "Admin user IDs: " MATTERMOST_ADMIN_USERS

        if [ -n "$MATTERMOST_ADMIN_USERS" ]; then
            echo -e "${GREEN}✓${NC} Admin users: $MATTERMOST_ADMIN_USERS"
        fi
    fi

    echo ""
    echo -e "${GREEN}✓${NC} Mattermost configuration complete!"
fi


# GitHub
SETUP_GITHUB=false
if [ -n "$GITHUB_TOKEN" ]; then
    echo -e "${GREEN}✓${NC} GitHub already configured"
    echo "     [u]pdate / [r]emove / [k]eep (default: keep)"
    read -p "     Choice: " GH_CHOICE
    case "$GH_CHOICE" in
        u|U|update)
            unset GITHUB_TOKEN
            SETUP_GITHUB=true
            ;;
        r|R|remove)
            unset GITHUB_TOKEN
            echo -e "${YELLOW}ℹ${NC}  GitHub configuration will be removed"
            ;;
    esac
else
    if confirm "Set up GitHub integration?" "y"; then
        SETUP_GITHUB=true
    fi
fi

if [ "$SETUP_GITHUB" = "true" ]; then
    prompt GITHUB_TOKEN "GitHub Personal Access Token" "" "true"
    echo -e "${BLUE}ℹ${NC}  Create token at: https://github.com/settings/tokens"
    echo "     Scopes needed: repo, workflow"
fi

echo ""

# Attio CRM
SETUP_ATTIO=false
if [ -n "$ATTIO_API_KEY" ]; then
    echo -e "${GREEN}✓${NC} Attio CRM already configured"
    echo "     [u]pdate / [r]emove / [k]eep (default: keep)"
    read -p "     Choice: " ATTIO_CHOICE
    case "$ATTIO_CHOICE" in
        u|U|update)
            unset ATTIO_API_KEY
            SETUP_ATTIO=true
            ;;
        r|R|remove)
            unset ATTIO_API_KEY
            echo -e "${YELLOW}ℹ${NC}  Attio configuration will be removed"
            ;;
    esac
else
    if confirm "Set up Attio CRM?" "n"; then
        SETUP_ATTIO=true
    fi
fi

if [ "$SETUP_ATTIO" = "true" ]; then
    prompt ATTIO_API_KEY "Attio API key" "" "true"
    echo -e "${BLUE}ℹ${NC}  Get API key at: https://app.attio.com/settings/api"
fi

echo ""

# Notion
SETUP_NOTION=false
if [ -n "$NOTION_API_KEY" ]; then
    echo -e "${GREEN}✓${NC} Notion already configured"
    echo "     [u]pdate / [r]emove / [k]eep (default: keep)"
    read -p "     Choice: " NOTION_CHOICE
    case "$NOTION_CHOICE" in
        u|U|update)
            unset NOTION_API_KEY
            SETUP_NOTION=true
            ;;
        r|R|remove)
            unset NOTION_API_KEY
            echo -e "${YELLOW}ℹ${NC}  Notion configuration will be removed"
            ;;
    esac
else
    if confirm "Set up Notion?" "n"; then
        SETUP_NOTION=true
    fi
fi

if [ "$SETUP_NOTION" = "true" ]; then
    prompt NOTION_API_KEY "Notion integration token" "" "true"
    echo -e "${BLUE}ℹ${NC}  Create integration at: https://www.notion.so/my-integrations"
fi

echo ""

# Storage
STORAGE_PATH=${STORAGE_PATH:-./storage}
CALENDAR_STORAGE_PATH=${CALENDAR_STORAGE_PATH:-./storage/calendars}

if confirm "Use MinIO for S3-compatible storage?" "n"; then
    MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://localhost:9000}
    MINIO_BUCKET=${MINIO_BUCKET:-nimbleco}
    MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY:-minioadmin}
    MINIO_SECRET_KEY=${MINIO_SECRET_KEY:-minioadmin}
else
    echo -e "${GREEN}✓${NC} Using local filesystem storage: $STORAGE_PATH"
fi

echo ""

# Dashboard
LAUNCH_DASHBOARD="n"
if [ "$QUICK_SETUP" = "false" ]; then
    if confirm "Launch admin dashboard?" "y"; then
        LAUNCH_DASHBOARD="y"
    fi
elif [ -n "$SAVED_LAUNCH_ADMIN_DASHBOARD_" ]; then
    LAUNCH_DASHBOARD="$SAVED_LAUNCH_ADMIN_DASHBOARD_"
else
    LAUNCH_DASHBOARD="y"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Writing Configuration${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Write .env file
cat > .env << EOF
# NimbleCo Configuration
# Generated: $(date)

# Core Infrastructure
NATS_URL=${NATS_URL}
DATABASE_URL=${DATABASE_URL}

# LLM Providers
OLLAMA_URL=${OLLAMA_URL}
LLM_MODEL_QUICK=${LLM_MODEL_QUICK}
LLM_MODEL_CODE=${LLM_MODEL_CODE}
LLM_DAILY_COST_LIMIT=${LLM_DAILY_COST_LIMIT}

ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTHROPIC_MODEL=${ANTHROPIC_MODEL}

VERTEX_AI_PROJECT=${VERTEX_AI_PROJECT}
VERTEX_AI_LOCATION=${VERTEX_AI_LOCATION}

AWS_REGION=${AWS_REGION}
BEDROCK_MODEL_ID=${BEDROCK_MODEL_ID}
AWS_BEARER_TOKEN_BEDROCK=${AWS_BEARER_TOKEN_BEDROCK}

# Mattermost
MATTERMOST_URL=${MATTERMOST_URL}
MATTERMOST_BOT_TOKEN=${MATTERMOST_BOT_TOKEN}
MATTERMOST_CHANNEL=${MATTERMOST_CHANNEL}
MATTERMOST_ADMIN_USERS=${MATTERMOST_ADMIN_USERS}
MATTERMOST_LOG_ALL_MESSAGES=true

# GitHub
GITHUB_TOKEN=${GITHUB_TOKEN}

# CRM
ATTIO_API_KEY=${ATTIO_API_KEY}

# Documentation
NOTION_API_KEY=${NOTION_API_KEY}

# Storage
STORAGE_PATH=${STORAGE_PATH}
CALENDAR_STORAGE_PATH=${CALENDAR_STORAGE_PATH}
MINIO_ENDPOINT=${MINIO_ENDPOINT}
MINIO_BUCKET=${MINIO_BUCKET}
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
AGENT_MAX_RETRIES=3
AGENT_TIMEOUT_MS=300000

# Dashboard
DASHBOARD_ENABLED=${LAUNCH_DASHBOARD}
EOF

echo -e "${GREEN}✓${NC} Configuration written to .env"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Installing Dependencies${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if confirm "Install npm dependencies?" "y"; then
    npm install
    echo -e "${GREEN}✓${NC} Dependencies installed"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Building Packages${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if confirm "Build TypeScript packages?" "y"; then
    npm run build
    echo -e "${GREEN}✓${NC} Packages built"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Starting Infrastructure${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Build list of services to mention
SERVICES="NATS, PostgreSQL"
[ -n "$MATTERMOST_BOT_TOKEN" ] && SERVICES="$SERVICES, Mattermost"
[ -n "$MINIO_ENDPOINT" ] && SERVICES="$SERVICES, MinIO"

if confirm "Start Docker infrastructure ($SERVICES)?" "y"; then
    # Check for and clean up old/conflicting containers
    echo -e "${BLUE}⏳${NC} Checking for conflicts..."

    # Remove old agile-* containers from before rename
    OLD_CONTAINERS=$(docker ps -a --format "{{.Names}}" 2>/dev/null | grep -E "^agile-" || true)
    if [ -n "$OLD_CONTAINERS" ]; then
        echo -e "${YELLOW}⚠${NC}  Found old containers from previous setup, removing..."
        echo "$OLD_CONTAINERS" | xargs -r docker rm -f > /dev/null 2>&1
        echo -e "${GREEN}✓${NC} Cleaned up old containers"
    fi

    # Check for port conflicts from non-Docker processes
    # Docker Desktop (com.docker.backend) will show as owner of container ports - that's normal
    # We only care about non-Docker processes blocking ports
    for PORT in 4222 5432 8222; do
        CONFLICT=$(lsof -i :$PORT -t 2>/dev/null | head -1)
        if [ -n "$CONFLICT" ]; then
            PROC_NAME=$(ps -p $CONFLICT -o comm= 2>/dev/null || echo "unknown")
            # Skip Docker-related processes - they're managing container ports, not blocking them
            if [[ "$PROC_NAME" == *"docker"* ]] || [[ "$PROC_NAME" == *"com.docke"* ]]; then
                # Port is used by Docker - check if it's our container or a stale one
                CONTAINER_ON_PORT=$(docker ps --format "{{.Names}}" --filter "publish=$PORT" 2>/dev/null | head -1)
                if [ -n "$CONTAINER_ON_PORT" ]; then
                    if [[ "$CONTAINER_ON_PORT" != nimble-* ]]; then
                        echo -e "${YELLOW}⚠${NC}  Port $PORT in use by container: $CONTAINER_ON_PORT"
                        if confirm "Stop container $CONTAINER_ON_PORT to free port?" "y"; then
                            docker stop "$CONTAINER_ON_PORT" > /dev/null 2>&1 || true
                            docker rm "$CONTAINER_ON_PORT" > /dev/null 2>&1 || true
                            echo -e "${GREEN}✓${NC} Removed $CONTAINER_ON_PORT"
                        fi
                    fi
                fi
            else
                # Non-Docker process blocking port
                echo -e "${YELLOW}⚠${NC}  Port $PORT in use by $PROC_NAME (PID $CONFLICT)"
                if confirm "Kill process to free port?" "y"; then
                    kill $CONFLICT 2>/dev/null || true
                    sleep 1
                fi
            fi
        fi
    done

    echo -e "${BLUE}⏳${NC} Starting core services..."
    docker-compose up -d nats postgres 2>&1 | grep -v "^$" || true

    echo -e "${BLUE}⏳${NC} Waiting for services to be ready..."
    sleep 5

    # Check NATS using docker health status
    NATS_STATUS=$(docker inspect --format='{{.State.Health.Status}}' nimble-nats 2>/dev/null || echo "not found")
    if [ "$NATS_STATUS" = "healthy" ]; then
        echo -e "${GREEN}✓${NC} NATS is running (healthy)"
    elif [ "$NATS_STATUS" = "starting" ]; then
        echo -e "${YELLOW}⏳${NC} NATS is still starting..."
        sleep 5
        NATS_STATUS=$(docker inspect --format='{{.State.Health.Status}}' nimble-nats 2>/dev/null || echo "not found")
        if [ "$NATS_STATUS" = "healthy" ]; then
            echo -e "${GREEN}✓${NC} NATS is running (healthy)"
        else
            echo -e "${RED}✗${NC} NATS health check: $NATS_STATUS"
            echo "     Debug: docker logs nimble-nats"
        fi
    else
        echo -e "${RED}✗${NC} NATS status: $NATS_STATUS"
        echo "     Debug: docker logs nimble-nats"
    fi

    # Check PostgreSQL
    if docker exec nimble-postgres pg_isready -U agent > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} PostgreSQL is running"
    else
        echo -e "${RED}✗${NC} PostgreSQL failed to start"
        echo "     Debug: docker logs nimble-postgres"
    fi

    # Start local Mattermost if configured
    if [ "$USE_LOCAL_MATTERMOST" = "true" ] && [ "$MATTERMOST_REMOVED" != "true" ]; then
        echo -e "${BLUE}⏳${NC} Starting Mattermost (takes ~30s)..."
        docker-compose up -d mattermost > /dev/null 2>&1
        echo -e "${GREEN}✓${NC} Mattermost starting at $MATTERMOST_URL"
    elif [ -n "$MATTERMOST_URL" ] && [ "$MATTERMOST_REMOVED" != "true" ]; then
        echo -e "${GREEN}✓${NC} Using hosted Mattermost: $MATTERMOST_URL (no local server needed)"
    fi

    # Start MinIO if configured
    if [ -n "$MINIO_ENDPOINT" ]; then
        echo -e "${BLUE}⏳${NC} Starting MinIO..."
        docker-compose up -d minio > /dev/null 2>&1
        echo -e "${GREEN}✓${NC} MinIO starting at $MINIO_ENDPOINT"
    fi
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Running Tests${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if confirm "Run tests to verify setup?" "y"; then
    echo -e "${BLUE}⏳${NC} Running tool tests..."
    if (cd shared/tools && npm test); then
        echo -e "${GREEN}✓${NC} All tests passing!"
    else
        echo -e "${YELLOW}⚠${NC}  Some tests failed (non-critical, continuing setup)"
    fi
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Starting Services${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if confirm "Start coordinator and agents with PM2?" "y"; then
    # Check if PM2 is installed
    if ! command -v pm2 &> /dev/null; then
        echo -e "${YELLOW}⚠${NC}  PM2 not installed. Installing globally..."
        npm install -g pm2
    fi

    # Create logs directory
    mkdir -p ./logs

    # Clean up any stale PM2 processes (e.g., from repo renames)
    STALE_PROCS=$(pm2 jlist 2>/dev/null | grep -o '"pm_exec_path":"[^"]*"' | grep -v "$PWD" | wc -l | tr -d ' ')
    if [ "$STALE_PROCS" -gt 0 ]; then
        echo -e "${YELLOW}⚠${NC}  Found PM2 processes from other directories, cleaning up..."
        pm2 delete all > /dev/null 2>&1 || true
        pm2 save --force > /dev/null 2>&1 || true
    fi

    echo -e "${YELLOW}⏳${NC} Starting services with PM2..."
    pm2 start ecosystem.config.js

    echo ""
    echo -e "${GREEN}✓${NC} Services started!"
    echo ""
    echo -e "${BLUE}Useful PM2 commands:${NC}"
    echo -e "   ${GREEN}pm2 list${NC}              - View all processes"
    echo -e "   ${GREEN}pm2 logs${NC}              - View all logs (live tail)"
    echo -e "   ${GREEN}pm2 logs coordinator${NC}  - View coordinator logs"
    echo -e "   ${GREEN}pm2 monit${NC}             - Interactive monitoring dashboard"
    echo -e "   ${GREEN}pm2 restart all${NC}       - Restart all services"
    echo -e "   ${GREEN}pm2 stop all${NC}          - Stop all services"
    echo ""
    SERVICES_STARTED=true
else
    SERVICES_STARTED=false
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  🎉 Setup Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ "$SERVICES_STARTED" = "false" ]; then
    echo -e "${BLUE}Next Steps:${NC}"
    echo ""
    echo "1. Start the coordinator:"
    echo -e "   ${GREEN}npm run coordinator${NC}"
    echo ""
    echo "2. In another terminal, start an agent:"
    echo -e "   ${GREEN}npm run agent:code-review${NC}"
    echo ""
    echo -e "   ${YELLOW}Or start everything with PM2:${NC}"
    echo -e "   ${GREEN}pm2 start ecosystem.config.js${NC}"
    echo ""
fi

if [ -n "$MATTERMOST_BOT_TOKEN" ]; then
    if [ "$SERVICES_STARTED" = "false" ]; then
        echo "3. Using Mattermost:"
    else
        echo -e "${BLUE}Using Mattermost:${NC}"
    fi
    echo ""
    echo -e "   ${GREEN}Your bot is configured!${NC}"
    echo -e "   ${GREEN}Server:${NC} ${BLUE}$MATTERMOST_URL${NC}"
    echo ""
    echo -e "   ${YELLOW}Next steps:${NC}"
    echo "     1. Open Mattermost and log in"
    echo "     2. Create or join a channel (e.g., 'agent-tasks')"
    echo "     3. @mention the bot to get started:"
    echo -e "        ${GREEN}@your-bot hello${NC}"
    echo -e "        ${GREEN}@your-bot what tools are available?${NC}"
    echo ""
    if [ -n "$MATTERMOST_ADMIN_USERS" ]; then
        echo -e "   ${GREEN}✓${NC} Admin users configured: $MATTERMOST_ADMIN_USERS"
        echo ""
    fi
fi

if [ "$SERVICES_STARTED" = "false" ]; then
    echo "4. Test the system:"
else
    echo -e "${BLUE}Test the system:${NC}"
fi
echo -e "   ${GREEN}npm run task:create -- --type pr-review --pr <pr-url>${NC}"
echo ""

echo -e "${BLUE}Documentation:${NC}"
echo "   • README.md - Overview and quick start"
echo "   • docs/context-sharing.md - Shift handoff workflow"
echo "   • docs/tool-system-overview.md - Tool architecture"
echo ""

echo -e "${BLUE}Monitoring:${NC}"
echo "   • NATS: http://localhost:8222"
echo "   • PostgreSQL: psql $DATABASE_URL"
echo -e "   • View costs: ${GREEN}docker exec nimble-postgres psql -U agent -d nimbleco -c 'SELECT * FROM v_daily_summary;'${NC}"

if [ "$LAUNCH_DASHBOARD" = "y" ]; then
    echo -e "   • ${GREEN}Dashboard: http://localhost:5173${NC}"
fi
echo ""

# Save session configuration for next time
echo "# Setup session saved $(date)" > .setup-last-session
# Save confirm answers (these are shell vars not env vars, so use 'set' not 'env')
set | grep '^SAVED_' >> .setup-last-session 2>/dev/null || true
# Also save key env vars for quick restore
echo "OLLAMA_URL=$OLLAMA_URL" >> .setup-last-session
echo "LLM_MODEL_QUICK=$LLM_MODEL_QUICK" >> .setup-last-session
echo "LLM_MODEL_CODE=$LLM_MODEL_CODE" >> .setup-last-session
echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" >> .setup-last-session
echo "ANTHROPIC_MODEL=$ANTHROPIC_MODEL" >> .setup-last-session
echo "AWS_REGION=$AWS_REGION" >> .setup-last-session
echo "BEDROCK_MODEL_ID=$BEDROCK_MODEL_ID" >> .setup-last-session
echo "AWS_BEARER_TOKEN_BEDROCK=$AWS_BEARER_TOKEN_BEDROCK" >> .setup-last-session
echo "GITHUB_TOKEN=$GITHUB_TOKEN" >> .setup-last-session
echo "MATTERMOST_BOT_TOKEN=$MATTERMOST_BOT_TOKEN" >> .setup-last-session
echo "MATTERMOST_URL=$MATTERMOST_URL" >> .setup-last-session
echo "MATTERMOST_CHANNEL=$MATTERMOST_CHANNEL" >> .setup-last-session
echo "MATTERMOST_ADMIN_USERS=$MATTERMOST_ADMIN_USERS" >> .setup-last-session
echo "ATTIO_API_KEY=$ATTIO_API_KEY" >> .setup-last-session
echo "NOTION_API_KEY=$NOTION_API_KEY" >> .setup-last-session
echo "MINIO_ENDPOINT=$MINIO_ENDPOINT" >> .setup-last-session
echo "MINIO_BUCKET=$MINIO_BUCKET" >> .setup-last-session
echo "MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY" >> .setup-last-session
echo "MINIO_SECRET_KEY=$MINIO_SECRET_KEY" >> .setup-last-session
echo "LAUNCH_DASHBOARD=$LAUNCH_DASHBOARD" >> .setup-last-session

echo -e "${GREEN}Happy agent orchestration! 🚀${NC}"
echo ""
