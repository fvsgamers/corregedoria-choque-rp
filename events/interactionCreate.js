const { Events, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

// Definição dos canais e categorias oficiais enviados por você
const ID_CANAL_RESULTADOS = "1529134537018441738"; 
const ID_CATEGORIA_TICKETS = "1565178591820386314";
const CAMINHO_CONTADOR = path.join(__dirname, '../contador.txt');

// Banco temporário em memória para salvar as etapas de fechamento de cada canal
const memoriaFechamento = new Map();

// Função auxiliar segura para ler e atualizar o número do protocolo incremental
function obterProximoCaso() {
    try {
        if (!fs.existsSync(CAMINHO_CONTADOR)) {
            fs.writeFileSync(CAMINHO_CONTADOR, '1', 'utf8');
            return 1;
        }
        const dados = fs.readFileSync(CAMINHO_CONTADOR, 'utf8').trim();
        const numeroAtual = parseInt(dados, 10) || 0;
        const proximoNumero = numeroAtual + 1;
        fs.writeFileSync(CAMINHO_CONTADOR, proximoNumero.toString(), 'utf8');
        return proximoNumero;
    } catch (error) {
        console.error("Erro ao manipular arquivo de contador:", error);
        return Math.floor(Math.random() * 9000) + 1000;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {

        // --- 1. COMANDOS DE BARRA (/) ---
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (!command) return;
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: 'Houve um erro ao executar esse comando!', ephemeral: true });
            }
        }

        // --- 2. INTERAÇÃO COM BOTÕES ---
        if (interaction.isButton()) {
            const { guild, user, customId, channelId } = interaction;
            
            // BOTÃO: Iniciar o processo de fechamento do chamado
            if (customId === 'btn_fechar_ticket') {
                const temAcesso = config.idCargoCorregedor.some(id => interaction.member.roles.cache.has(id)) || 
                                  config.idCargoStaff.some(id => interaction.member.roles.cache.has(id)) || 
                                  interaction.member.permissions.has(PermissionFlagsBits.Administrator);

                if (!temAcesso) {
                    return interaction.reply({ content: "❌ Apenas membros da Corregedoria ou Staff podem definir o veredicto deste caso.", ephemeral: true });
                }

                const dadosExistentes = memoriaFechamento.get(channelId);
                if (dadosExistentes && dadosExistentes.isRevogacao) {
                    const embedEscolha = new EmbedBuilder()
                        .setTitle("⚖️ ESCOLHA O VEREDICTO DA REVOGAÇÃO")
                        .setDescription(`Usuário solicitante: <@${dadosExistentes.envolvidos}>\nCargo para revisar: <@&${dadosExistentes.cargoParaRemover}>\n\nEscolha o desfecho deste pedido de revisão:`)
                        .setColor(0x2f3136);

                    const rowEscolhas = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('btn_final_deferido').setLabel('✅ Deferido (Retirar Punição)').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('btn_final_indeferido').setLabel('❌ Indeferido (Manter Punição)').setStyle(ButtonStyle.Danger)
                    );

                    return interaction.reply({ embeds: [embedEscolha], components: [rowEscolhas] });
                }

                const embedFiltro = new EmbedBuilder()
                    .setTitle("👤 SELEÇÃO DE ENVOLVIDOS")
                    .setDescription("Selecione abaixo o(s) usuário(s) que receberá(ão) o veredicto deste caso. Você pode marcar mais de um se necessário:")
                    .setColor(0x2f3136);

                const menuUsuarios = new UserSelectMenuBuilder()
                    .setCustomId('selecao_membros_caso')
                    .setPlaceholder('Clique aqui para selecionar os envolvidos...')
                    .setMinValues(1)
                    .setMaxValues(10);

                const rowUsuarios = new ActionRowBuilder().addComponents(menuUsuarios);

                return interaction.reply({ embeds: [embedFiltro], components: [rowUsuarios] });
            }

            // BOTÃO: Veredicto Deferido (Abre seleção de advertências OU processa revogação direto)
            if (customId === 'btn_final_deferido') {
                const dadosCaso = memoriaFechamento.get(channelId);
                
                if (dadosCaso && dadosCaso.isRevogacao) {
                    let canalResultados = guild.channels.cache.get(ID_CANAL_RESULTADOS);
                    const numeroFinalDoCaso = obterProximoCaso();
                    const ID_CANAL_TRANSCRIPTS = "1565194110199930971";
                    const ID_CARGO_GERAL_ADV = "13947740627062874"; 

                    const idMembro = dadosCaso.envolvidos;
                    try {
                        const membroAlvo = await guild.members.fetch(idMembro).catch(() => null);
                        if (membroAlvo) {
                            const cargoIdPuro = Array.isArray(dadosCaso.cargoParaRemover) ? dadosCaso.cargoParaRemover[0] : dadosCaso.cargoParaRemover;
                            if (cargoIdPuro) await membroAlvo.roles.remove(cargoIdPuro).catch(() => {});
                            await membroAlvo.roles.remove(ID_CARGO_GERAL_ADV).catch(() => {});
                        }
                    } catch (err) { console.error(err); }

                    const textoMensagem = 
                        `### ⚖️ REVOGAÇÃO DEFERIDA + #${numeroFinalDoCaso}\n` +
                        `> **STATUS JURÍDICO:** SENTENÇA REFORMADA (PUNIÇÃO REVOGADA)\n\n` +
                        `A Corregedoria Geral determinou o **DEFERIMENTO** do pedido. As sanções anteriores foram anuladas e removidas de sua ficha funcional.\n\n` +
                        `👤 **Cidadão Beneficiado:** <@${idMembro}>\n` +
                        `❌ **Sanção Retirada:** <@&${dadosCaso.cargoParaRemover}>\n\n` +
                        `✍ *Corregedor Responsável:* <@${interaction.user.id}> — <t:${Math.floor(Date.now() / 1000)}:R>`;

                    if (canalResultados) {
                        await canalResultados.send({ content: `🔔 **Aviso de Revogação:** <@${idMembro}>\n\n${textoMensagem}` }).catch(err => console.error(err));
                    }

                    // Log simplificado canal revogação
                    try {
                        const canalLogsRevogacao = await guild.channels.fetch('1529134489341788421').catch(() => null);
                        if (canalLogsRevogacao) {
                            const textoLogRevogacao = `### 📝 REVOGAÇÃO DEFERIDA (PUNIÇÃO RETIRADA)\n**QRA:** <@${idMembro}>\n**MOTIVO:** Revisão aprovada no Caso #${numeroFinalDoCaso}\n**ADVERTÊNCIA RETIRADA:** <@&${dadosCaso.cargoParaRemover}>\n**STATUS:** Cargo removido.\n**CORREGEDOR RESPONSÁVEL:** <@${interaction.user.id}>`;
                            await canalLogsRevogacao.send({ content: textoLogRevogacao }).catch(() => {});
                        }
                    } catch (e) {}

                    try {
                        const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
                        let conteudoTexto = `=== TRANSCRIPT OFICIAL - REVOGAÇÃO ACEITA #${numeroFinalDoCaso} ===\n`;
                        const msgOrdenadas = mensagens.reverse();
                        msgOrdenadas.forEach(m => { conteudoTexto += `[${m.createdAt.toLocaleTimeString('pt-BR')}] ${m.author.tag}: ${m.content}\n`; });
                        const bufferTexto = Buffer.from(conteudoTexto, 'utf-8');
                        const canalAuditoria = guild.channels.cache.get(ID_CANAL_TRANSCRIPTS);
                        if (canalAuditoria) await canalAuditoria.send({ content: `📁 **Logs de Revogação:** Caso \`#${numeroFinalDoCaso}\` deferido por ${interaction.user}.`, files: [{ attachment: bufferTexto, name: `revogacao-${numeroFinalDoCaso}.txt` }] });
                    } catch (e) { console.error(e); }

                    await interaction.update({ content: `🔒 **Revogação Processada com Sucesso!** Cargo removido e logs salvos.\n⚠️ *Este canal será deletado em 10 segundos.*`, embeds: [], components: [] });
                    memoriaFechamento.delete(channelId);
                    return setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
                }

                // Fluxo normal de ticket de denúncia (abrir menu de punições)
                const menuAdvs = new StringSelectMenuBuilder()
                    .setCustomId('menu_advertencias_multiplas')
                    .setPlaceholder('Selecione uma ou mais advertências...')
                    .setMinValues(1)
                    .setMaxValues(config.opcoesPunicao.length)
                    .addOptions(config.opcoesPunicao);

                const rowAdvs = new ActionRowBuilder().addComponents(menuAdvs);
                return interaction.update({ content: '🚨 **Selecione as punições aplicáveis abaixo:**', embeds: [], components: [rowAdvs] });
            }

            // BOTÃO: Veredicto Indeferido (Texto Elaborado + Transcript + Delete em 10s)
            if (customId === 'btn_final_indeferido') {
                const dadosCaso = memoriaFechamento.get(channelId);

                if (!dadosCaso) {
            return await interaction.reply({content: "❌ **Erro:** Você precisa selecionar ao menos 1 envolvido no menu de usuários antes de definir o veredicto.", ephemeral: true }).catch(() => {});
                }

                await interaction.deferUpdate().catch(() => {});

                const canalResultados = guild.channels.cache.get(ID_CANAL_RESULTADOS);
                const numeroFinalDoCaso = obterProximoCaso();
                const ID_CANAL_TRANSCRIPTS = "1565194110199930971";

                if (canalResultados) {
                    const idMembro = dadosCaso.envolvidos;
                    
                    if (dadosCaso.isRevogacao) {
                        const textoMensagemIndeferido = 
                            `### 🏛️ REVOGAÇÃO INDEFERIDA + #${numeroFinalDoCaso}\n` +
                            `> **STATUS JURÍDICO:** CONTESTAÇÃO REJEITADA (PUNIÇÃO MANTIDA)\n\n` +
                            `A Corregedoria Geral avaliou os fundamentos do pedido de revisão e determinou o seu **INDEFERIMENTO**. As sanções originais permanecem ativas.\n\n` +
                            `👤 **Colaborador:** <@${idMembro}>\n` +
                            `⚠️ **Manutenção da Sanção:** <@&${dadosCaso.cargoParaRemover}>\n\n` +
                            `✍️ *Relator Responsável:* \`${interaction.user.tag}\` — <t:${Math.floor(Date.now() / 1000)}:R>`;

                        await canalResultados.send({ content: `🔔 **Notificação de Julgamento:** <@${idMembro}>\n\n${textoMensagemIndeferido}` }).catch(err => console.error(err));

                        try {
                            const canalLogsRevogacao = await guild.channels.fetch('1529134489341788421').catch(() => null);
                            if (canalLogsRevogacao) {
                                const textoLogRevogacaoNegada = `### 📝 REVOGAÇÃO INDEFERIDA (PUNIÇÃO MANTIDA)\n**QRA:** <@${idMembro}>\n**MOTIVO:** Pedido de revisão rejeitado no Caso #${numeroFinalDoCaso}\n**ADVERTÊNCIA MANTIDA:** <@&${dadosCaso.cargoParaRemover}>\n**STATUS:** Sanção ativa.\n**CORREGEDOR RESPONSÁVEL:** <@${interaction.user.id}>`;
                                await canalLogsRevogacao.send({ content: textoLogRevogacaoNegada }).catch(() => {});
                            }
                        } catch (e) {}

                        try {
                            const canalLogsEspecifico = await guild.channels.fetch('1529134407330562239').catch(() => null);
                            if (canalLogsEspecifico) {
                                const textoLogSimplificado = `**QRA:** <@${idMembro}>\n**STATUS:** REVOGAÇÃO INDEFERIDA (PUNIÇÃO MANTIDA)\n**MOTIVO HISTÓRICO:** Pedido de revisão rejeitado no Caso #${numeroFinalDoCaso}\n**SANÇÃO MANTIDA:** <@&${dadosCaso.cargoParaRemover}>\n**RESPONSÁVEL:** <@${interaction.user.id}>`;
                                await canalLogsEspecifico.send({ content: textoLogSimplificado }).catch(err => console.error(err));
                            }
                        } catch (err) {}

                    } else {
                        const listaMencionados = Array.isArray(dadosCaso.envolvidos) ? dadosCaso.envolvidos.map(id => `<@${id}>`).join(', ') : `<@${dadosCaso.envolvidos}>`;

                        const textoMensagemIndeferido = 
                            `### 🏛️ INDEFERIDO + #${numeroFinalDoCaso}\n` +
                            `> **STATUS JURÍDICO:** SENTENZA INDEFERIDA (IMPROCEDENTE)\n\n` +
                            `A Corregedoria Geral da Cidade declara o processo **ARQUIVADO**.\n\n` +
                            `👤 **Membros Citados:** ${listaMencionados}\n\n` +
                            `⚠️ **Fundamentação da Recusa:**\nA postulação foi rejeitada por **total ausência de elementos probatórios concretos**.\n\n` +
                            `✍️ *Relator Responsável:* \`${interaction.user.tag}\` — <t:${Math.floor(Date.now() / 1000)}:R>`;

                        await canalResultados.send({ content: `🔔 **Notificação de Arquivamento:** ${listaMencionados}\n\n${textoMensagemIndeferido}` }).catch(err => console.error(err));

                        try {
                            const canalLogsEspecifico = await guild.channels.fetch('1529134407330562239').catch(() => null);
                            if (canalLogsEspecifico) {
                                const textoLogSimplificado = `**QRA:** ${listaMencionados}\n**STATUS:** ARQUIVADO / INDEFERIDO\n**MOTIVO HISTÓRICO:** Chamado encerrado no Caso #${numeroFinalDoCaso}\n**MOTIVO:** Ausência de elementos probatórios.\n**RESPONSÁVEL:** <@${interaction.user.id}>`;
                                await canalLogsEspecifico.send({ content: textoLogSimplificado }).catch(err => console.error(err));
                            }
                        } catch (err) {}
                    }
                }

                try {
                    const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
                    let conteudoTexto = `=== TRANSCRIPT OFICIAL DE ATENDIMENTO - CASO INDEFERIDO #${numeroFinalDoCaso} ===\n`;
                    const msgOrdenadas = mensagens.reverse();
                    msgOrdenadas.forEach(m => { conteudoTexto += `[${m.createdAt.toLocaleTimeString('pt-BR')}] ${m.author.tag}: ${m.content}\n`; });
                    const bufferTexto = Buffer.from(conteudoTexto, 'utf-8');
                    const canalAuditoria = guild.channels.cache.get(ID_CANAL_TRANSCRIPTS);
                    if (canalAuditoria) await canalAuditoria.send({ content: `📁 **Histórico:** Caso \`#${numeroFinalDoCaso}\` finalizado por ${interaction.user}.`, files: [{ attachment: bufferTexto, name: `transcript-indeferido-${numeroFinalDoCaso}.txt` }] }).catch(() => {});
                } catch (e) {}

                await interaction.editReply({ content: `🔒 **Caso Indeferido com Sucesso!** Relatório publicado e enviado para a auditoria.\n⚠️ *Este canal será permanentemente deletado em 10 segundos.*`, embeds: [], components: [] }).catch(() => {});
                memoriaFechamento.delete(channelId);
                return setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 10000);
            }

            // --- LÓGICA DE CRIAÇÃO DE NOVOS TICKETS PRIVADOS ---
            let nomeCanal = "";
            let cargoAcessoId = "";
            let embedTicket = new EmbedBuilder();
            let mencaoCargo = "";

            if (customId === 'btn_corregedoria') {
                nomeCanal = `⚖️-corregedoria-${user.username}`;
                cargoAcessoId = config.idCargoCorregedor || "";
                mencaoCargo = cargoAcessoId ? `<@&${cargoAcessoId}>` : "@Corregedoria";

                embedTicket
                    .setTitle("⚖️ CORREGEDORIA GERAL DA CIDADE")
                    .setDescription(`Prezado(a) cidadão(ã) ${user},\n\nVocê está no canal oficial de atendimento da **Corregedoria Geral**.\n\n⚠️ **Garantia de Sigilo:** Nos termos do regimento, todas as informações são confidential.\n\nPara iniciarmos a investigação, **envie abaixo as seguintes informações**:`)
                    .addFields({ name: '📋 Formulário de Abertura', value: `• **Seu Passaporte (ID):**\n• **Nome ou ID do Oficial Envolvido:**\n• **Corporação/Organização:** (Ex: PM, PC)\n• **Relato Detalhado:**\n• **Link de Provas:** (Vídeo anexado no YouTube/Medal)` })
                    .setColor(0xff0000)
                    .setTimestamp();
            }

            if (customId === 'btn_revogacao') {
                nomeCanal = `📝-revogacao-${user.username}`;
                cargoAcessoId = config.idCargoStaff || "";
                mencaoCargo = cargoAcessoId ? `<@&${cargoAcessoId}>` : "@Staff";

                embedTicket
                    .setTitle("📝 DEPARTAMENTO DE REVISÃO E REVOGAÇÃO")
                    .setDescription(`Olá ${user},\n\nEste canal foi aberto para apresentar sua contestação formal de punições aplicadas no servidor.\n\nPreencha a sua ficha de defesa abaixo:`)
                    .addFields({ name: '📋 Ficha de Contestação', value: `• **Seu Passaporte (ID):**\n• **Qual punição deseja revogar?**\n• **Quem aplicou a punição?**\n• **Sua Justificativa/Defesa:**` })
                    .setColor(0x0000ff)
                    .setTimestamp();
            }

            if (nomeCanal) {
                const regrasPermissao = [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
                ];

                if (cargoAcessoId && guild.roles.cache.has(cargoAcessoId)) {
                    regrasPermissao.push({ id: cargoAcessoId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
                }

                try {
                    const canalCriado = await guild.channels.create({ name: nomeCanal, type: 0, parent: ID_CATEGORIA_TICKETS, permissionOverwrites: regrasPermissao });
                    await interaction.reply({ content: `✅ Seu canal administrativo foi aberto com sucesso em ${canalCriado}`, ephemeral: true });

                    const rowFechar = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('btn_fechar_ticket').setLabel('🔒 Fechar Ticket').setStyle(ButtonStyle.Secondary));
                    const componentesEnvio = [rowFechar];

                    if (customId === 'btn_corregedoria') {
                        const rowMenuCitar = new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('citar_participantes').setPlaceholder('⚖️ Selecione até 10 pessoas para a defesa').setMinValues(1).setMaxValues(10));
                        componentesEnvio.push(rowMenuCitar);
                                        }

                    if (customId === 'btn_revogacao') {
                        const rowMenuRevogar = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('selecao_adv_para_revogar').setPlaceholder('🚨 Selecione qual advertência deseja revisar...').setMinValues(1).setMaxValues(1) .addOptions(config.opcoesPunicao));
                        componentesEnvio.push(rowMenuRevogar);
                    }

                    await canalCriado.send({ content: mencaoCargo, embeds: [embedTicket], components: componentesEnvio });
                } catch (error) {
                    console.error(error);
                    await interaction.reply({ content: "❌ Erro ao criar canal.", ephemeral: true });
                }
            }
        }

        // --- 3. GERENCIAMENTO DE SELEÇÃO DE MENUS ---
        if (interaction.isAnySelectMenu()) {
            const { customId, values, channelId, guild } = interaction;

            if (customId === 'selecao_adv_para_revogar') {
                memoriaFechamento.set(channelId, { envolvidos: interaction.user.id, cargoParaRemover: values, isRevogacao: true });
                return await interaction.reply({ content: `✅ Você selecionou a advertência <@&${values}> para revisão.\nPreencha a ficha acima e aguarde um Corregedor.`, });
            }

            if (customId === 'citar_participantes') {
                const temPermissao = config.idCargoCorregedor.some(id => interaction.member.roles.cache.has(id)) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
                if (!temPermissao) return await interaction.reply({ content: `❌ Sem permissão.`, ephemeral: true });

                await interaction.reply({ content: `🔄 Aplicando acessos...`, ephemeral: true });
                const usuariosSelecionados = interaction.users;
                const mencoes = usuariosSelecionados.map(user => `<@${user.id}>`).join(', ');

                for (const [id, user] of usuariosSelecionados) {
                    await interaction.channel.permissionOverwrites.create(id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
                }
                return await interaction.channel.send({ content: `✍️ *Participante(s) Convocado(s):* ${mencoes} — por <@${interaction.user.id}> em <t:${Math.floor(Date.now() / 1000)}:R>\n\n⚠️ **Prezado(a)(s), você foi citado.** Fica convocado(a) a apresentar sua defesa legal.` });
            }

            if (customId === 'selecao_membros_caso') {
                memoriaFechamento.set(channelId, { envolvidos: values });
                const embedEscolha = new EmbedBuilder().setTitle("⚖️ ESCOLHA O VEREDICTO FINAL").setDescription(`Membros selecionados:\n${values.map(id => `<@${id}>`).join('\n')}\n\nEscolha o desfecho:`).setColor(0x2f3136);
                const rowEscolhas = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('btn_final_deferido').setLabel('✅ Deferido (Aplicar Punição)').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('btn_final_indeferido').setLabel('❌ Indeferido (Falta de Provas)').setStyle(ButtonStyle.Danger)
                );
                return interaction.update({ embeds: [embedEscolha], components: [rowEscolhas] });
            }

            if (customId === 'menu_advertencias_multiplas') {
                const dadosCaso = memoriaFechamento.get(channelId);
                if (!dadosCaso) return interaction.reply({ content: "❌ Caso expirou.", ephemeral: true });

                dadosCaso.cargosSelecionados = values;
                memoriaFechamento.set(channelId, dadosCaso);

                const menuCursos = new StringSelectMenuBuilder()
                    .setCustomId('menu_cursos_retirados_lista')
                    .setPlaceholder('Selecione quais cursos/cargos serão RETIRADOS...')
                    .setMinValues(1)
                    .setMaxValues(config.cargosParaRetirar.length)
                    .addOptions(config.cargosParaRetirar);

                return interaction.update({ content: '🎓 **Selecione os cursos ou cargos que serão RETIRADOS do infrator:**', embeds: [], components: [new ActionRowBuilder().addComponents(menuCursos)] });
            }

            if (customId === 'menu_cursos_retirados_lista') {
                const dadosCaso = memoriaFechamento.get(channelId);
                if (!dadosCaso) return interaction.reply({ content: "❌ Caso expirou.", ephemeral: true });

                dadosCaso.cursosParaRemoverEfetivo = values;
                memoriaFechamento.set(channelId, dadosCaso);

                const btnModal = new ButtonBuilder()
                    .setCustomId('btn_abrir_modal_motivo')
                    .setLabel('✍️ Escrever Motivo da Sentença (Obrigatório)')
                    .setStyle(ButtonStyle.Primary);

                return interaction.update({ content: '✅ **Cargos e cursos definidos com sucesso!** Clique no botão abaixo para preencher a fundamentação obrigatória da sentença:', components: [new ActionRowBuilder().addComponents(btnModal)] });
            }
        }

                // =====================================================================
        // 🔒 FIX: OUVIDO DE BOTÃO DO MODAL REGISTRADO CORRETAMENTE
        // =====================================================================
        if (interaction.isButton() && interaction.customId === 'btn_abrir_modal_motivo') {
            try {
                const modal = new ModalBuilder()
                    .setCustomId('modal_motivo_punicao')
                    .setTitle('⚖️ Justificativa da Sentença');

                const inputMotivo = new TextInputBuilder()
                    .setCustomId('txt_motivo_detalhado')
                    .setLabel('Descrição/Motivo da Punição (Obrigatório)')
                    .setPlaceholder('Digite detalhadamente o motivo/artigo infringido...')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(10)
                    .setMaxLength(1000)
                    .setRequired(true);

                const rowComponente = new ActionRowBuilder().addComponents(inputMotivo);
                modal.addComponents(rowComponente);

                // Abre a janela pop-up na tela do corregedor imediatamente
                return await interaction.showModal(modal);
            } catch (error) {
                console.error("Erro ao abrir o formulário de motivo:", error);
                return await interaction.reply({
                    content: "❌ Não foi possível abrir o formulário. Tente clicar novamente no botão.",
                    ephemeral: true
                }).catch(() => {});
            }
        }
        // =====================================================================


        if (interaction.isModalSubmit() && interaction.customId === 'modal_motivo_punicao') {
            const { channelId, guild } = interaction;
            
            await interaction.deferReply().catch(() => {});
            
            const dadosCaso = memoriaFechamento.get(channelId);
            if (!dadosCaso) return interaction.editReply({ content: "❌ Dados expirados." });

            const motivoDigitado = interaction.fields.getTextInputValue('txt_motivo_detalhado');
            let canalResultados = guild.channels.cache.get(ID_CANAL_RESULTADOS);
            if (!canalResultados) { try { canalResultados = await guild.channels.fetch(ID_CANAL_RESULTADOS); } catch (e) {} }

            const numeroFinalDoCaso = obterProximoCaso();
            const ID_CARGO_GERAL_ADV = "13947740627062874"; 
            const ID_CANAL_TRANSCRIPTS = "1565194110199930971";

            const cargosMarcados = dadosCaso.cargosSelecionados || [];
            const cursosRetiradosMarcados = dadosCaso.cursosParaRemoverEfetivo || [];

            for (const idMembro of dadosCaso.envolvidos) {
                try {
                    const miembroAlvo = await guild.members.fetch(idMembro).catch(() => null);
                    if (miembroAlvo) {
                        await miembroAlvo.roles.add(ID_CARGO_GERAL_ADV).catch(() => {});
                        for (const idCargoPunicao of cargosMarcados) { await miembroAlvo.roles.add(idCargoPunicao).catch(() => {}); }
                        for (const idCurso of cursosRetiradosMarcados) { if (idCurso !== 'nenhum') await miembroAlvo.roles.remove(idCurso).catch(() => {}); }
                    }
                } catch (err) { console.error(err); }

                const cargosMencionadosString = cargosMarcados.length > 0 ? cargosMarcados.map(id => `<@&${id}>`).join(', ') : `Nenhuma punição aplicada`;
                const temposAdvsMarcadas = cargosMarcados.length > 0 ? cargosMarcados.map(id => { const configPunicao = config.opcoesPunicao.find(o => o.value === id); return configPunicao ? `• <@&${id}>: *${configPunicao.tempo}*` : ''; }).filter(t => t !== '').join('\n') : `Nenhum tempo registrado`;
                const textoCursosRemovidosString = cursosRetiradosMarcados.filter(id => id !== 'nenhum').length > 0 ? cursosRetiradosMarcados.filter(id => id !== 'nenhum').map(id => `<@&${id}>`).join(', ') : `Nenhum curso ou cargo retirado`;

                const textoMensagem = 
                    `### ⚖️ DEFERIDO + #${numeroFinalDoCaso}\n` +
                    `> **STATUS JURÍDICO:** SENTENÇA DEFERIDA (PROCEDENTE)\n\n` +
                    `👤 **Infrator Penalizado:** <@${idMembro}>\n\n` +
                    `📝 **Motivação Técnico-Regulamentar:**\n> ${motivoDigitado}\n\n` +
                    `⚠️ **Sanções Regimentais Aplicadas:**\n${cargosMencionadosString}\n\n` +
                    `🎓 **Cursos/Cargos Retirados:**\n${textoCursosRemovidosString}\n\n` +
                    `✍️ *Relator Responsible:* <@${interaction.user.id}> — <t:${Math.floor(Date.now() / 1000)}:R>`;

                if (canalResultados) await canalResultados.send({ content: `🔔 **Citação Processual:** <@${idMembro}>\n\n${textoMensagem}` }).catch(() => {});

                try {
                    const canalLogsEspecifico = await guild.channels.fetch('1529134407330562239').catch(() => null);
                    if (canalLogsEspecifico) {
                        const textoLogSimplificado = `**QRA:** <@${idMembro}>\n**MOTIVO HISTÓRICO:** Caso corregedoria #${numeroFinalDoCaso}\n**MOTIVO:** ${motivoDigitado}\n**ADVERTÊNCIA APLICADA:** ${cargosMencionadosString}\n**TEMPO DE VIGÊNCIA:** ${temposAdvsMarcadas}\n**CURSOS RETIRADOS:** ${textoCursosRemovidosString}\n**RESPONSÁVEL:** <@${interaction.user.id}>`;
                        await canalLogsEspecifico.send({ content: textoLogSimplificado }).catch(() => {});
                    }
                } catch (err) {}
            }

            try {
                const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
                let conteudoTexto = `=== TRANSCRIPT OFICIAL DE ATENDIMENTO - CASO #${numeroFinalDoCaso} ===\n`;
                                const msgOrdenadas = mensagens.reverse();
                msgOrdenadas.forEach(m => { conteudoTexto += `[${m.createdAt.toLocaleTimeString('pt-BR')}] ${m.author.tag}: ${m.content}\n`; });
                const canalAuditoria = guild.channels.cache.get(ID_CANAL_TRANSCRIPTS);
                if (canalAuditoria) await canalAuditoria.send({ content: `📁 **Histórico:** Caso \`#${numeroFinalDoCaso}\`.`, files: [{ attachment: Buffer.from(conteudoTexto, 'utf-8'), name: `transcript-caso-${numeroFinalDoCaso}.txt` }] }).catch(() => {});
            } catch (errTranscript) {}

            await interaction.editReply({ content: `🔒 **Caso Deferido com Sucesso!** Veredicto publicado, justificativa anexada e histórico salvo.\n⚠️ *Este canal será permanentemente deletado em 10 segundos.*`, embeds: [], components: [] }).catch(() => {});
            memoriaFechamento.delete(channelId);
            return setTimeout(() => { if (interaction.channel) interaction.channel.delete().catch(() => {}); }, 10000);
        }
    },
};
